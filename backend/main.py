"""AutoLab SCADA local bridge. Never expose this server beyond loopback.

Run: python -m uvicorn main:app --host 127.0.0.1 --port 8000
Arduino firmware protocol: CMD,<id>,<action>,... / ACK / DATA / EVENT.
"""
from __future__ import annotations

import asyncio
import copy
import csv
import io
import json
import os
import queue
import secrets
import sqlite3
import threading
import time
from collections import deque
from contextlib import asynccontextmanager,contextmanager,closing
from datetime import datetime, timezone
from pathlib import Path

import serial
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.cors import CORSMiddleware

PORT = os.getenv('ARDUINO_PORT', 'COM6')
BAUD = 115200
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(__file__).resolve().parent / 'autolab_history.sqlite3'
# Only exact front-end origins may access this loopback-only service.
APP_ORIGINS = {'https://nf-niloy.github.io', 'http://127.0.0.1:8000', 'http://localhost:8000'}
PAIR_CODE = f'{secrets.randbelow(1_000_000):06d}'
CONTROL_TOKEN = secrets.token_urlsafe(36)
PAIR_FAILURES = deque(maxlen=50)
AUTH_UNTIL = 0.0



def now_iso():
    return datetime.now(timezone.utc).isoformat()


def valid_float(text):
    try:
        number = float(text)
        return number if number == number and abs(number) != float('inf') else None
    except (ValueError, TypeError):
        return None


def connect_db():
    db = sqlite3.connect(DB_PATH, timeout=5)
    db.execute('PRAGMA busy_timeout=5000')
    return db


@contextmanager
def db_session():
    with closing(connect_db()) as db:
        with db:
            yield db


def init_db():
    with db_session() as db:
        db.execute('PRAGMA journal_mode=WAL')
        # Preserve compatibility with the previously tested SQLite file.
        db.execute('''CREATE TABLE IF NOT EXISTS telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          sequence INTEGER, uptime_ms INTEGER, ds18b20_c REAL, mlx90614_c REAL,
          motor INTEGER, fan INTEGER, mode TEXT, step INTEGER, cycle INTEGER, fault TEXT
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL, uptime_ms INTEGER, kind TEXT, raw TEXT
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
          status TEXT NOT NULL, reason TEXT, recipe_json TEXT NOT NULL,
          start_uptime_ms INTEGER, finish_uptime_ms INTEGER
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS run_steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL, cycle INTEGER, step INTEGER,
          started_uptime_ms INTEGER, finished_uptime_ms INTEGER, paused_ms INTEGER DEFAULT 0,
          FOREIGN KEY (run_id) REFERENCES runs(id)
        )''')


class ArduinoBridge:
    def __init__(self):
        self.lock = threading.RLock()
        self.control_lock = threading.Lock()
        self.stop_signal = threading.Event()
        self.outgoing = queue.Queue()
        self.pending = {}
        self.thread = None
        self.connected = False
        self.last_received = None
        self.last_error = None
        self.latest = None
        self.events = deque(maxlen=120)
        self.next_command_id = 100
        self.active_run = None

    def start(self):
        self.thread = threading.Thread(target=self._worker, name='ArduinoSerialWorker', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_signal.set()
        if self.thread:
            self.thread.join(timeout=3)

    def status(self):
        with self.lock:
            age = time.monotonic() - self.last_received if self.last_received is not None else None
            fresh = bool(self.connected and age is not None and age < 4)
            return {
                'port': PORT,
                'serial_connected': self.connected,
                'telemetry_fresh': fresh,
                'last_data_age_seconds': round(age, 2) if age is not None else None,
                'telemetry': copy.deepcopy(self.latest) if fresh else None,
                'active_run': copy.deepcopy(self.active_run) if fresh else None,
                'recent_events': list(self.events)[-35:],
                'last_error': self.last_error,
            }

    def command(self, action: str, timeout=4.0):
        with self.lock:
            age = time.monotonic() - self.last_received if self.last_received is not None else 999
            if not self.connected or age >= 4:
                raise RuntimeError('Arduino is disconnected or telemetry is stale')
            cmd_id = str(self.next_command_id)
            self.next_command_id += 1
            entry = {'event': threading.Event(), 'reply': None, 'sent_at': None}
            self.pending[cmd_id] = entry
            self.outgoing.put((cmd_id, action))
        if not entry['event'].wait(timeout):
            with self.lock:
                self.pending.pop(cmd_id, None)
            raise TimeoutError('Arduino did not acknowledge the command')
        reply = entry['reply']
        if reply is None:
            raise RuntimeError('Arduino communication was lost')
        if not reply['ok']:
            raise ValueError(reply['message'])
        return reply

    def _fail_pending(self):
        with self.lock:
            for entry in self.pending.values():
                entry['reply'] = None
                entry['event'].set()
            self.pending.clear()
            while True:
                try: self.outgoing.get_nowait()
                except queue.Empty: break
            self.active_run = None

    def _finish_step(self, db, end_ms):
        run = self.active_run
        if not run or not run.get('current_step'):
            return
        current = run.pop('current_step')
        paused_at = run.pop('pause_started_ms',None)
        if paused_at is not None and end_ms is not None:
            current['paused_ms'] = current.get('paused_ms',0) + max(0,end_ms-paused_at)
        db.execute('''INSERT INTO run_steps (run_id,cycle,step,started_uptime_ms,finished_uptime_ms,paused_ms)
                      VALUES (?,?,?,?,?,?)''', (run['id'], current['cycle'], current['step'], current['uptime_ms'], end_ms, current.get('paused_ms',0)))

    def _finish_run(self, db, status, reason, end_ms):
        run = self.active_run
        if run is None:
            return
        self._finish_step(db, end_ms)
        db.execute('UPDATE runs SET finished_at=?,status=?,reason=?,finish_uptime_ms=? WHERE id=?',
                   (now_iso(),status,reason,end_ms,run['id']))
        self.active_run = None

    def _read_event(self, line, parts, db):
        uptime = int(parts[1]) if len(parts)>1 and parts[1].isdigit() else None
        kind = parts[2] if len(parts)>2 else 'OTHER'
        timestamp = now_iso()
        cursor = db.execute('INSERT INTO events (recorded_at,uptime_ms,kind,raw) VALUES (?,?,?,?)',
                            (timestamp, uptime, kind, line))
        with self.lock:
            self.events.append({'id': cursor.lastrowid, 'time': timestamp, 'raw': line})
            run = self.active_run
            if kind == 'RUN_START' and run:
                run['start_uptime_ms'] = uptime
                db.execute('UPDATE runs SET start_uptime_ms=? WHERE id=?', (uptime,run['id']))
            elif kind == 'STEP' and len(parts)>=5 and run:
                self._finish_step(db, uptime)
                run['current_step'] = {'step':int(parts[3]),'cycle':int(parts[4]),'uptime_ms':uptime,'paused_ms':0}
            elif kind == 'RUN_PAUSED' and run and run.get('current_step'):
                run['pause_started_ms'] = uptime
            elif kind == 'RUN_RESUMED' and run and run.get('current_step'):
                started = run.pop('pause_started_ms',None)
                if started is not None:
                    run['current_step']['paused_ms'] += max(0,uptime-started)
            elif kind == 'RUN_COMPLETE':
                self._finish_run(db,'COMPLETED','',uptime)
            elif kind == 'STOPPED':
                self._finish_run(db,'STOPPED','Operator stop',uptime)
            elif kind == 'FAULT':
                self._finish_run(db,'FAULTED',parts[3] if len(parts)>3 else 'FAULT',uptime)
            elif kind == 'RESET':
                self._finish_run(db,'STOPPED','Controller reset',uptime)
            elif kind == 'BOOT':
                self._finish_run(db,'INTERRUPTED','Arduino reset',uptime)
        db.commit()

    def _process_line(self, line, db):
        parts = line.split(',')
        if parts[0] == 'DATA' and len(parts)>=11:
            try:
                row = {
                    'sequence': int(parts[1]), 'uptime_ms': int(parts[2]),
                    'ds18b20_c': valid_float(parts[3]), 'mlx90614_c': valid_float(parts[4]),
                    'motor': bool(int(parts[5])), 'fan': bool(int(parts[6])),
                    'mode': parts[7], 'step': int(parts[8]), 'cycle': int(parts[9]),
                    'fault': parts[10], 'recorded_at': now_iso(),
                }
            except (ValueError, IndexError):
                return
            with self.lock:
                self.latest = row
                self.last_received = time.monotonic()
                if self.active_run and row['mode'] == 'FAULT':
                    self._finish_run(db,'FAULTED',row['fault'],row['uptime_ms'])
            db.execute('''INSERT INTO telemetry (recorded_at,sequence,uptime_ms,ds18b20_c,mlx90614_c,
                          motor,fan,mode,step,cycle,fault) VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                       (row['recorded_at'],row['sequence'],row['uptime_ms'],row['ds18b20_c'],row['mlx90614_c'],
                        int(row['motor']),int(row['fan']),row['mode'],row['step'],row['cycle'],row['fault']))
            db.commit()
        elif parts[0] == 'ACK' and len(parts)>=4:
            with self.lock:
                entry = self.pending.pop(parts[1],None)
                if entry:
                    latency = round((time.monotonic()-entry['sent_at'])*1000,2) if entry['sent_at'] else None
                    entry['reply'] = {'ok':parts[2]=='OK','message':','.join(parts[3:]),
                                      'command_id':parts[1],'ack_latency_ms':latency}
                    entry['event'].set()
        elif parts[0] == 'EVENT':
            self._read_event(line,parts,db)
        elif parts[0] == 'READY':
            with self.lock:
                self.events.append({'id':f'boot-{time.monotonic()}','time':now_iso(),'raw':line})

    def _worker(self):
        db = connect_db()
        try:
            while not self.stop_signal.is_set():
                try:
                    with serial.Serial(PORT,BAUD,timeout=.1,write_timeout=1) as device:
                        time.sleep(2.2)  # UNO resets on serial open
                        with self.lock:
                            self.connected = True
                            self.last_received = None
                            self.latest = None
                            self.last_error = None
                        last_ping = 0
                        while not self.stop_signal.is_set():
                            now = time.monotonic()
                            if now-last_ping>=2:
                                device.write(b'CMD,HB,PING\n')
                                last_ping = now
                            try:
                                cmd_id,action = self.outgoing.get_nowait()
                                with self.lock:
                                    entry = self.pending.get(cmd_id)
                                if entry:
                                    frame = f'CMD,{cmd_id},{action}\n'
                                    with self.lock:
                                        entry['sent_at'] = time.monotonic()
                                    device.write(frame.encode('ascii'))
                            except queue.Empty:
                                pass
                            raw = device.readline()
                            if raw:
                                line = raw.decode('ascii',errors='replace').strip()
                                if line:
                                    self._process_line(line,db)
                        # Best effort stop on normal service exit.
                        try:
                            device.write(b'CMD,0,STOP\n')
                            device.flush()
                        except Exception:
                            pass
                except (serial.SerialException,OSError) as exc:
                    with self.lock:
                        self.last_error = str(exc)
                finally:
                    with self.lock:
                        self.connected = False
                        if self.active_run is not None:
                            self._finish_run(db,'INTERRUPTED','USB connection lost',self.latest['uptime_ms'] if self.latest else None)
                            db.commit()
                    self._fail_pending()
                if not self.stop_signal.is_set():
                    time.sleep(2)
        finally:
            db.close()


bridge = ArduinoBridge()


@asynccontextmanager
async def lifespan(app:FastAPI):
    init_db()
    bridge.start()
    print('\n' + '=' * 62, flush=True)
    print(' AUTOLAB SCADA - PRIVATE LOCAL CONTROL', flush=True)
    print(f' Pairing code: {PAIR_CODE}', flush=True)
    print(' Enter this code in the GitHub Pages dashboard to unlock', flush=True)
    print(' physical motor / fan control. Never share this code.', flush=True)
    print('=' * 62 + '\n', flush=True)
    yield
    bridge.stop()


app = FastAPI(title='AutoLab SCADA — Local Hardware API',version='stable',lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost'])
app.add_middleware(CORSMiddleware,allow_origins=sorted(APP_ORIGINS),
                   allow_methods=['GET','POST','OPTIONS'],allow_headers=['Authorization','Content-Type'],
                   allow_credentials=False,max_age=300)

@app.middleware('http')
async def restrict_cross_site_commands(request:Request,call_next):
    origin = request.headers.get('origin')
    if request.method == 'OPTIONS' and origin in APP_ORIGINS:
        # Some browsers send a Private Network Access preflight when an HTTPS
        # GitHub Pages tab asks for the operator's HTTP loopback service.
        response=Response(status_code=204)
        response.headers.update({
            'Access-Control-Allow-Origin':origin,
            'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers':'Authorization, Content-Type',
            'Access-Control-Allow-Private-Network':'true',
            'Access-Control-Max-Age':'300','Vary':'Origin',
        })
        return response
    if origin and origin not in APP_ORIGINS:
        return Response('Origin not allowed',status_code=403)
    if request.method in ('POST','PUT','PATCH','DELETE') and request.url.path.startswith('/api/'):
        if origin is None and request.headers.get('sec-fetch-site') == 'cross-site':
            return Response('Cross-site commands blocked',status_code=403)
    response = await call_next(request)
    if origin in APP_ORIGINS:
        response.headers['Access-Control-Allow-Private-Network']='true'
    return response


def require_control(request:Request):
    global AUTH_UNTIL
    auth=request.headers.get('Authorization','')
    supplied=auth[7:] if auth.startswith('Bearer ') else ''
    if not (time.monotonic()<AUTH_UNTIL and secrets.compare_digest(supplied,CONTROL_TOKEN)):
        raise HTTPException(401, 'Pair this browser with the local controller first')


class PairRequest(BaseModel):
    code:str=Field(min_length=6,max_length=6)


@app.post('/api/pair')
def pair(payload:PairRequest,request:Request):
    global AUTH_UNTIL
    now=time.monotonic()
    while PAIR_FAILURES and PAIR_FAILURES[0]<now-60:
        PAIR_FAILURES.popleft()
    if len(PAIR_FAILURES)>=5:
        raise HTTPException(429,'Too many attempts. Wait one minute.')
    if not secrets.compare_digest(payload.code,PAIR_CODE):
        PAIR_FAILURES.append(now)
        raise HTTPException(401,'Incorrect pairing code')
    AUTH_UNTIL=now+8*3600
    return Response(json.dumps({'token':CONTROL_TOKEN,'expires_in_seconds':8*3600}),
                    media_type='application/json',headers={'Cache-Control':'no-store'})


@app.get('/api/control-session')
def control_session(_:None=Depends(require_control)):
    return {'authorized':True}


class Toggle(BaseModel):
    on:bool


class Step(BaseModel):
    seconds:int=Field(ge=2,le=120)
    label:str=Field(default='',max_length=45)
    motor:bool=False
    fan:bool=False

    @model_validator(mode='after')
    def interlock(self):
        if self.motor and self.fan:
            raise ValueError('Motor and fan cannot both be ON')
        return self


class Recipe(BaseModel):
    name:str=Field(default='Untitled run',min_length=1,max_length=62)
    steps:list[Step]=Field(min_length=1,max_length=8)
    cycles:int=Field(default=1,ge=1,le=20)


def send(action):
    try:
        return bridge.command(action)
    except ValueError as exc:
        raise HTTPException(409,str(exc))
    except (RuntimeError,TimeoutError) as exc:
        raise HTTPException(503,str(exc))


@app.get('/api/status')
def status():
    return bridge.status()


@app.post('/api/motor')
def motor(payload:Toggle, _:None=Depends(require_control)):
    with bridge.control_lock:
        return send('MOTOR,ON' if payload.on else 'MOTOR,OFF')


@app.post('/api/fan')
def fan(payload:Toggle, _:None=Depends(require_control)):
    with bridge.control_lock:
        return send('FAN,ON' if payload.on else 'FAN,OFF')


@app.post('/api/stop')
def stop(_:None=Depends(require_control)):
    with bridge.control_lock:
        return send('STOP')


@app.post('/api/reset')
def reset(_:None=Depends(require_control)):
    with bridge.control_lock:
        return send('RESET')


@app.post('/api/recipe/run')
def run_recipe(recipe:Recipe, _:None=Depends(require_control)):
    with bridge.control_lock:
        data = bridge.status()
        if bridge.active_run is not None or not data['telemetry_fresh'] or not data['telemetry'] or data['telemetry']['mode'] != 'IDLE':
            raise HTTPException(409,'Controller must be connected and IDLE before running a recipe')
        send('RECIPE,CLEAR')
        try:
            for step in recipe.steps:
                send(f'RECIPE,ADD,{step.seconds},{int(step.motor)},{int(step.fan)}')
            with db_session() as db:
                with bridge.lock:
                    cursor=db.execute('INSERT INTO runs (name,started_at,status,recipe_json) VALUES (?,?,?,?)',
                                      (recipe.name,now_iso(),'RUNNING',recipe.model_dump_json()))
                    bridge.active_run = {'id':cursor.lastrowid,'name':recipe.name,'recipe':recipe.model_dump(),
                                         'start_uptime_ms':None,'current_step':None}
                db.commit()
            try:
                result=send(f'RECIPE,RUN,{recipe.cycles}')
            except Exception:
                with db_session() as db:
                    with bridge.lock:
                        bridge._finish_run(db,'REJECTED','Arduino did not start',None)
                    db.commit()
                raise
        except Exception:
            try: send('STOP')
            except Exception: pass
            raise
        return {'result':result,'steps':len(recipe.steps),'cycles':recipe.cycles}


@app.post('/api/recipe/pause')
def pause(_:None=Depends(require_control)):
    with bridge.control_lock:
        return send('PAUSE')


@app.post('/api/recipe/resume')
def resume(_:None=Depends(require_control)):
    with bridge.control_lock:
        return send('RESUME')


@app.get('/api/history')
def history(limit:int=180):
    limit=max(1,min(1800,limit))
    with db_session() as db:
        db.row_factory=sqlite3.Row
        rows=db.execute('SELECT * FROM telemetry ORDER BY id DESC LIMIT ?', (limit,)).fetchall()
        return [dict(row) for row in reversed(rows)]


def read_run(db, row, with_samples=False):
    recipe=json.loads(row['recipe_json'])
    steps=db.execute('''SELECT * FROM run_steps WHERE run_id=? ORDER BY id''',(row['id'],)).fetchall()
    recorded=[]
    for st in steps:
        duration=(st['finished_uptime_ms']-st['started_uptime_ms']-(st['paused_ms'] or 0))/1000 if st['finished_uptime_ms'] is not None and st['started_uptime_ms'] is not None else None
        idx=st['step']-1
        template=recipe['steps'][idx] if 0<=idx<len(recipe['steps']) else {}
        planned=template.get('seconds',0)
        recorded.append({'cycle':st['cycle'],'step':st['step'],'label':template.get('label',f'Step {st["step"]}'),
                         'planned':planned,'observed':round(duration,3) if duration is not None else None,
                         'timingError':round(duration-planned,3) if duration is not None else None,
                         'motor':template.get('motor',False),'fan':template.get('fan',False)})
    start=row['start_uptime_ms'];end=row['finish_uptime_ms']
    active=(sum(max(0,(st['finished_uptime_ms']-st['started_uptime_ms']-(st['paused_ms'] or 0))/1000)
                for st in steps if st['finished_uptime_ms'] is not None and st['started_uptime_ms'] is not None)
            if steps else None)
    record={'id':str(row['id']),'name':row['name'],'source':'HARDWARE','status':row['status'],
            'startedAt':row['started_at'],'finishedAt':row['finished_at'],
            'plannedDuration':sum(s['seconds'] for s in recipe['steps'])*recipe['cycles'],
            'activeSeconds':active,'cycles':recipe['cycles'],
            'stepsPlanned':len(recipe['steps'])*recipe['cycles'],
            'stepsCompleted':len(recorded),'recordedSteps':recorded,
            'reason':row['reason'],'recipe':recipe,'samples':[]}
    if with_samples:
        if row['finished_at']:
            ts=db.execute('''SELECT * FROM telemetry WHERE recorded_at BETWEEN ? AND ? ORDER BY id LIMIT 1800''',
                          (row['started_at'],row['finished_at'])).fetchall()
        else:
            ts=db.execute('''SELECT * FROM telemetry WHERE recorded_at >= ? ORDER BY id LIMIT 1800''',
                          (row['started_at'],)).fetchall()
        record['samples']=[{'time':v['recorded_at'],'sec':(v['uptime_ms'] or 0)/1000,
                            'contact':v['ds18b20_c'],'infrared':v['mlx90614_c'],
                            'ambient':None,'motor':v['motor'],'fan':v['fan'],'mode':v['mode'],
                            'sequence':v['sequence'],'source':'HARDWARE'} for v in ts]
    return record


@app.get('/api/runs')
def runs(limit:int=40):
    limit=max(1,min(100,limit))
    with db_session() as db:
        db.row_factory=sqlite3.Row
        rows=db.execute('SELECT * FROM runs ORDER BY id DESC LIMIT ?',(limit,)).fetchall()
        return [read_run(db,row) for row in rows]


@app.get('/api/runs/{run_id}')
def run_detail(run_id:int):
    with db_session() as db:
        db.row_factory=sqlite3.Row
        row=db.execute('SELECT * FROM runs WHERE id=?',(run_id,)).fetchone()
        if not row:
            raise HTTPException(404,'Run not found')
        return read_run(db,row,with_samples=True)


@app.get('/api/export/telemetry.csv')
def export_telemetry(limit:int=1800):
    rows=history(limit)
    stream=io.StringIO()
    writer=csv.DictWriter(stream,fieldnames=['recorded_at','sequence','uptime_ms','ds18b20_c','mlx90614_c',
                                             'motor','fan','mode','step','cycle','fault'],extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    return Response(stream.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="autolab-hardware-telemetry.csv"'})


@app.websocket('/ws/live')
async def ws_live(websocket:WebSocket):
    # Read-only streaming; commands are separately bearer-token protected.
    origin=websocket.headers.get('origin')
    if origin and origin not in APP_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(bridge.status())
            await asyncio.sleep(0.5)
    except (WebSocketDisconnect,RuntimeError):
        pass


@app.get('/')
def frontend():
    return FileResponse(ROOT/'index.html')


app.mount('/src',StaticFiles(directory=ROOT/'src'),name='source')
app.mount('/assets',StaticFiles(directory=ROOT/'assets'),name='assets')
app.mount('/docs-assets',StaticFiles(directory=ROOT/'docs'),name='docs-assets')

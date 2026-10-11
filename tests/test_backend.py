"""Mock validation: no real Arduino needed. python -m unittest discover -s tests"""
import importlib
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

# Developer CI may not have pyserial. Stub its import, never touch hardware.
if 'serial' not in sys.modules:
    try:
        import serial
    except ImportError:
        mock_serial = types.ModuleType('serial')
        mock_serial.SerialException = type('SerialException', (Exception,), {})
        mock_serial.Serial = lambda *args, **kwargs: (_ for _ in ()).throw(mock_serial.SerialException('offline'))
        sys.modules['serial'] = mock_serial

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
api = importlib.import_module('backend.main')


class TestBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.previous_db = api.DB_PATH
        api.DB_PATH = Path(cls._tmp.name)/'test.sqlite3'
        api.init_db()

    @classmethod
    def tearDownClass(cls):
        api.DB_PATH = cls.previous_db
        cls._tmp.cleanup()

    def setUp(self):
        api.bridge = api.ArduinoBridge()
        self.client = TestClient(api.app, base_url='http://127.0.0.1:8000')

    def test_frontend_and_offline_controls(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertIn('mode-switch',self.client.get('/').text)
        self.assertEqual(self.client.get('/src/live-controller.js').status_code,200)
        self.assertEqual(self.client.get('/api/status').json()['telemetry_fresh'],False)
        self.assertEqual(self.client.post('/api/motor',json={'on':True}).status_code,503)
        self.assertEqual(self.client.post('/api/stop',headers={'origin':'https://random.example'}).status_code,403)

    def test_telemetry_persisted_and_run_step_timing(self):
        bridge = api.bridge
        with api.connect_db() as db:
            bridge.connected=True
            bridge.last_received=time.monotonic()
            cursor=db.execute('INSERT INTO runs (name,started_at,status,recipe_json) VALUES (?,?,?,?)',
                              ('Mock process',api.now_iso(),'RUNNING',
                               '{"name":"Mock process","cycles":1,"steps":[{"seconds":5,"label":"Motor","motor":true,"fan":false},{"seconds":5,"label":"Fan","motor":false,"fan":true}]}'))
            bridge.active_run={'id':cursor.lastrowid,'name':'Mock process','recipe':{'cycles':1,'steps':[{'seconds':5,'motor':True,'fan':False},{'seconds':5,'motor':False,'fan':True}]},'current_step':None,'start_uptime_ms':None}
            db.commit()
            bridge._process_line('EVENT,100000,RUN_START',db)
            bridge._process_line('EVENT,100000,STEP,1,1',db)
            bridge._process_line('DATA,8,101000,30.50,30.40,1,0,AUTO,1,1,NONE',db)
            bridge._process_line('EVENT,105000,STEP,2,1',db)
            bridge._process_line('EVENT,110000,RUN_COMPLETE',db)
        self.assertEqual(self.client.get('/api/status').json()['telemetry']['ds18b20_c'],30.50)
        rows=self.client.get('/api/history?limit=1').json()
        self.assertEqual(rows[-1]['mode'],'AUTO')
        runs=self.client.get('/api/runs').json()
        record=next(x for x in runs if x['name']=='Mock process')
        self.assertEqual(record['status'],'COMPLETED')
        self.assertEqual(record['stepsCompleted'],2)
        self.assertEqual([s['observed'] for s in record['recordedSteps']],[5.,5.])
        self.assertEqual(self.client.get(f"/api/runs/{record['id']}").status_code,200)
        self.assertIn('text/csv',self.client.get('/api/export/telemetry.csv').headers['content-type'])

    def test_recipe_validation(self):
        invalid={'name':'bad','steps':[{'seconds':10,'motor':True,'fan':True}],'cycles':1}
        self.assertEqual(self.client.post('/api/recipe/run',json=invalid).status_code,422)
        invalid['steps']=[{'seconds':121,'motor':True,'fan':False}]
        self.assertEqual(self.client.post('/api/recipe/run',json=invalid).status_code,422)
        invalid['steps']=[{'seconds':5,'motor':True,'fan':False}]
        with patch.object(api.bridge,'command',return_value={'ok':True,'message':'test'}) as cmd:
            api.bridge.connected=True
            api.bridge.last_received=time.monotonic()
            api.bridge.latest={'mode':'IDLE'}
            response=self.client.post('/api/recipe/run',json=invalid)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(cmd.call_count,3)
            self.assertIn('RECIPE,RUN,1',str(cmd.call_args_list))


if __name__=='__main__':unittest.main()

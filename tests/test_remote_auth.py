"""Remote safety tests; no physical device is accessed."""
import hashlib, importlib, json, sys, tempfile, time, types, unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
try:
    import serial
except ImportError:
    s=types.ModuleType('serial')
    s.SerialException=type('SerialException',(Exception,),{})
    s.Serial=lambda *a,**kw:(_ for _ in ()).throw(s.SerialException('Device offline'))
    sys.modules['serial']=s

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
api=importlib.import_module('backend.main')

class RemoteAuthTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.private=Path(self.temp.name)
        salt=b'1'*24
        hashed=hashlib.pbkdf2_hmac('sha256',b'123456',salt,300_000)
        (self.private/'credentials.json').write_text(json.dumps({'salt':salt.hex(),'hash':hashed.hex(),'iterations':300_000}))
        self.old_creds,self.old_fails=api.CREDS,api.FAILURES
        api.CREDS=self.private/'credentials.json'
        api.FAILURES=self.private/'lock.json'
        self.addCleanup(self.restore)
        self.client=TestClient(api.app,base_url='http://127.0.0.1:8000')
        self.origin={'Origin':'https://nf-niloy.github.io'}
        with api.LOGIN_LOCK:
            api.SESSIONS.clear()
            api.CONTROL_ACTIVE=False
        api.bridge=api.ArduinoBridge()
        api.bridge.connected=True
        api.bridge.last_received=time.monotonic()
        api.bridge.latest={'sequence':3,'uptime_ms':1234,'ds18b20_c':27.5,'mlx90614_c':26.3,'motor':False,'fan':False,'mode':'IDLE','step':0,'cycle':0,'fault':'NONE','recorded_at':'2026-01-01T00:00:00Z'}
    def restore(self):
        api.CREDS,api.FAILURES=self.old_creds,self.old_fails
    def login(self):
        resp=self.client.post('/api/pair',json={'code':'123456'},headers=self.origin)
        self.assertEqual(resp.status_code,200,resp.text)
        return resp.json()['token']
    def test_public_readings_hidden(self):
        reply=self.client.get('/api/status',headers=self.origin).json()
        self.assertTrue(reply['telemetry_fresh'])
        self.assertIsNone(reply['telemetry']['ds18b20_c'])
        self.assertEqual(self.client.get('/api/history',headers=self.origin).status_code,401)
    def test_login_unique_tokens_and_logout(self):
        a=self.login();b=self.login()
        self.assertNotEqual(a,b)
        h={**self.origin,'Authorization':'Bearer '+a}
        reply=self.client.get('/api/status',headers=h)
        self.assertEqual(reply.status_code,200)
        self.assertEqual(reply.json()['telemetry']['ds18b20_c'],27.5)
        with patch.object(api.bridge,'command',return_value={'ok':True}):
            self.assertEqual(self.client.post('/api/motor',headers=h,json={'on':True}).status_code,200)
        self.assertEqual(self.client.post('/api/logout',headers=h).status_code,200)
        self.assertEqual(self.client.post('/api/motor',headers=h,json={'on':True}).status_code,401)
        self.assertEqual(self.client.get('/api/control-session',headers={**self.origin,'Authorization':'Bearer '+b}).status_code,200)
    def test_pin_throttle_and_origin(self):
        for _ in range(5):
            self.assertEqual(self.client.post('/api/pair',json={'code':'000000'},headers=self.origin).status_code,401)
        self.assertEqual(self.client.post('/api/pair',json={'code':'123456'},headers=self.origin).status_code,429)
        self.assertEqual(self.client.post('/api/pair',json={'code':'123456'},headers={'Origin':'https://evil.example'}).status_code,403)
    def test_anonymous_commands_blocked(self):
        self.assertEqual(self.client.post('/api/stop',headers=self.origin).status_code,401)
        self.assertEqual(self.client.post('/api/motor',headers=self.origin,json={'on':True}).status_code,401)
    def test_lease_stop_after_disconnect(self):
        a=self.login();h={**self.origin,'Authorization':'Bearer '+a}
        with patch.object(api.bridge,'command',return_value={'ok':True}) as mock:
            self.client.post('/api/motor',json={'on':True},headers=h)
            self.assertTrue(api.CONTROL_ACTIVE)
            api.CONTROL_LAST_SEEN=time.monotonic()-60
            class OneTick:
                def __init__(self):self.n=0
                def wait(self,n): self.n+=1;return self.n>1
            api.control_watchdog(OneTick())
            self.assertFalse(api.CONTROL_ACTIVE)
            self.assertIn(('STOP',),[call.args for call in mock.call_args_list])

if __name__=='__main__':unittest.main()

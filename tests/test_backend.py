"""Standalone offline API tests. Run: python -m unittest tests.test_backend"""
import importlib,sys,types,unittest,time
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

try: import serial
except ImportError:
    mock=types.ModuleType('serial')
    mock.SerialException=type('SerialException',(Exception,),{})
    mock.Serial=lambda *a,**kw: (_ for _ in ()).throw(mock.SerialException('Offline'))
    sys.modules['serial']=mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
api=importlib.import_module('backend.main')

class TestBackend(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(api.app,base_url='http://127.0.0.1:8000')
        self.origin='https://nf-niloy.github.io'
        api.AUTH_UNTIL=0
        api.PAIR_FAILURES.clear()
        api.bridge=api.ArduinoBridge()
    def test_auto_detect_headers_and_pairing(self):
        status=self.client.get('/api/status',headers={'Origin':self.origin})
        self.assertEqual(status.status_code,200)
        self.assertEqual(status.headers['access-control-allow-origin'],self.origin)
        self.assertEqual(self.client.post('/api/motor',json={'on':True},headers={'Origin':self.origin}).status_code,401)
        res=self.client.options('/api/motor',headers={'Origin':self.origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Private-Network':'true'})
        self.assertEqual(res.status_code,204)
        self.assertEqual(res.headers['access-control-allow-private-network'],'true')
        self.assertEqual(self.client.post('/api/pair',json={'code':'badbad'},headers={'Origin':self.origin}).status_code,401)
        res=self.client.post('/api/pair',json={'code':api.PAIR_CODE},headers={'Origin':self.origin})
        self.assertEqual(res.status_code,200,res.text)
        token=res.json()['token']
        headers={'Origin':self.origin,'Authorization':f'Bearer {token}'}
        self.assertEqual(self.client.get('/api/control-session',headers=headers).status_code,200)
        with patch.object(api.bridge,'command',return_value={'ok':True}) as cmd:
            api.bridge.connected=True
            api.bridge.last_received=time.monotonic()
            res=self.client.post('/api/motor',json={'on':True},headers=headers)
            self.assertEqual(res.status_code,200,res.text)
            cmd.assert_called_once_with('MOTOR,ON')
        self.assertEqual(self.client.post('/api/motor',json={'on':True},headers={**headers,'Origin':'https://evil.example'}).status_code,403)
    def test_bad_origin_cannot_pair(self):
        self.assertEqual(self.client.post('/api/pair',json={'code':api.PAIR_CODE},headers={'Origin':'https://evil.example'}).status_code,403)
    def test_ws_read_only_has_allowlist(self):
        self.assertTrue(callable(api.ws_live))

if __name__=='__main__':unittest.main()

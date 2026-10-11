"""Backend static validation, without requiring a USB device."""
import importlib,sys,types,unittest
from pathlib import Path
try:
    import serial
except ImportError:
    mock=types.ModuleType('serial')
    mock.SerialException=type('SerialException',(Exception,),{})
    mock.Serial=lambda *a,**kw: (_ for _ in ()).throw(mock.SerialException('Offline'))
    sys.modules['serial']=mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
api=importlib.import_module('backend.main')

class TestBackend(unittest.TestCase):
    def test_controller_is_bound_by_start_script(self):
        launcher=(Path(__file__).resolve().parents[1]/'run_live.bat').read_text()
        self.assertIn('--host 127.0.0.1',launcher)
        self.assertNotIn('--host 0.0.0.0',launcher)
    def test_public_pin_not_hardcoded(self):
        self.assertFalse(hasattr(api,'PAIR_CODE'))
        self.assertFalse(hasattr(api,'CONTROL_TOKEN'))
        self.assertTrue(callable(api.correct_pin))
        self.assertTrue(callable(api.control_watchdog))
    def test_public_origin_is_exact(self):
        self.assertIn('https://nf-niloy.github.io',api.APP_ORIGINS)
        self.assertNotIn('*',api.APP_ORIGINS)

if __name__=='__main__':unittest.main()

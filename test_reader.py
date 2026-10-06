import importlib.util,json,pathlib,unittest
P=pathlib.Path(__file__).with_name('read_agent_logs.py')
spec=importlib.util.spec_from_file_location('agent_reader',P);reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class SafeReaderTests(unittest.TestCase):
 def test_old_python_compatible_time_forms(self):
  for line in ['2026-01-02 03:04:05.999 task','2026/01/02T03:04:05 task']:
   self.assertEqual(reader.timestamp(line).isoformat(),'2026-01-02T03:04:05')
  self.assertNotIn('fromisoformat',P.read_text())
 def test_invalid_time_fails_closed(self):
  for line in ['opaque command no time','2026-99-02 03:04:05 bad','2026-01-02 99:04:05 bad']:
   self.assertIsNone(reader.timestamp(line))
 def test_sensitive_body_never_returned(self):
  line='2026-01-02 03:04:05 invoke t-synthetictask001 start AccessKeySecret=SYNTHETIC_PRIVATE_VALUE Signature=SYNTHETIC_SIGNATURE'
  row=reader.safe_row(line,'synthetic.log',7)
  result=json.dumps(row)
  self.assertNotIn('SYNTHETIC_PRIVATE_VALUE',result);self.assertNotIn('SYNTHETIC_SIGNATURE',result)
  self.assertEqual(row['invokeIds'],['t-synthetictask001']);self.assertEqual(len(row['lineSha256']),64)
 def test_exit_code_is_separate_from_word_tags(self):
  row=reader.safe_row('2026-01-02 03:04:05 invoke t-synthetictask001 timeout=60 success exit code=0','synthetic',1)
  self.assertEqual(row['exitCode'],0)
  self.assertIn('timeout',row['eventTags'])
  self.assertNotIn('InvocationStatus',row)
if __name__=='__main__':unittest.main()

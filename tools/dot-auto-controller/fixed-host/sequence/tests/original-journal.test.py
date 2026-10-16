"""Original non-sequence journals retain their single-link behavior.
Tiny real filesystem cases remain outside source. No fixtures are removed.
"""
from pathlib import Path
import json,os,sys,tempfile,types,unittest
sys.dont_write_bytecode=True
HOST=Path(__file__).resolve().parents[2]
ROOT=HOST.parents[2]
EVIDENCE=Path(os.environ['SEQUENCE_TEST_EVIDENCE']).resolve()
assert EVIDENCE.is_relative_to(ROOT.parent) and not EVIDENCE.is_relative_to(ROOT)
CASES=EVIDENCE/'original-journal'/'lifecycle-cases';CASES.mkdir(mode=0o700,parents=True,exist_ok=True)
p=HOST/'lifecycle/lifecycle_lock.py';raw=p.read_text();assert raw.count('__FIXED_LIFECYCLE_SCOPE__')==1
raw=raw.replace('__FIXED_LIFECYCLE_SCOPE__',repr({'kind':'TEST_ONLY','casesRoot':str(CASES)}))
m=types.ModuleType('original_journal_regression');m.__file__=str(p);sys.modules[m.__name__]=m;exec(compile(raw,str(p),'exec'),m.__dict__)
class Original(unittest.TestCase):
 def setUp(self):
  self.case=Path(tempfile.mkdtemp(prefix='case-',dir=CASES));self.domain=m.provision_for_installer(self.case,'original-source')
 def test_original_single_link_round_finishes_without_sequence_begin(self):
  with self.domain.acquire('SH') as lease:
   j=m.OwnedRoundJournal(lease);active=self.case/self.domain.active_name
   self.assertEqual(active.stat().st_nlink,1);self.assertEqual(active.read_bytes(),j.raw)
   self.assertFalse(list(self.case.glob('*.lifecycle-sequence-begin-*')))
   j.finish_from_owned_holder();self.assertFalse(active.exists())
  with m.exclusive_transaction(self.domain) as lease:lease.finish_mutation_from_owned_transaction()
 def test_original_round_never_accepts_link_two(self):
  with self.domain.acquire('SH') as lease:
   j=m.OwnedRoundJournal(lease);active=self.case/self.domain.active_name;os.link(active,self.case/'retained-linked-active')
   with self.assertRaisesRegex(m.Hold,'JOURNAL_CHANGED'):j.finish_from_owned_holder()
   j.abandon();self.assertTrue(active.exists())
 def test_original_mutation_death_remains_hold(self):
  with m.exclusive_transaction(self.domain):pass
  for mode in ('SH','EX'):
   with self.assertRaisesRegex(m.Hold,'ACTIVE_OR_UNKNOWN_MUTATION'):self.domain.acquire(mode)
 def test_original_round_death_remains_hold(self):
  with self.domain.acquire('SH') as lease:
   j=m.OwnedRoundJournal(lease);j.abandon()
  with self.assertRaisesRegex(m.Hold,'ACTIVE_OR_UNKNOWN_ROUND'):
   with m.exclusive_transaction(self.domain):pass
if __name__=='__main__':unittest.main()

"""Pure regression of actual prepare-only probe validation. No installed paths,
processes, dependencies, native qualification or filesystem case is created.
"""
from pathlib import Path
import copy,runpy,sys,unittest
sys.dont_write_bytecode=True
source=Path(__file__).resolve().parents[1]/'test-installed-prepare.py'
n=runpy.run_path(str(source));validate=n['validate_prepared_identities']
def fixture():
 return [{'profile':p,'prepared':{'roundId':'round-'+str(i)*32,'seed':{'sourceId':n['SOURCE_IDS'][p],'batchId':'batch-'+str(i),'launchChallenge':'challenge-'+str(i)},'cfg':{'sourceId':n['SOURCE_IDS'][p]}},'stateRoot':'/synthetic/sources/'+p} for i,p in enumerate(('takeda','biogen','hengrui','ucb','viatris'),1)]
class Identities(unittest.TestCase):
 def test_actual_hengrui_id_and_five_distinct_tuples_are_accepted(self):
  rows=fixture();self.assertEqual(rows[2]['prepared']['seed']['sourceId'],'source-hengrui-social');self.assertEqual(rows[3]['prepared']['seed']['sourceId'],'source-ucb-china-social');validate(rows)
  self.assertEqual(n['REPORT_KIND'],'ACTUAL_INSTALLED_FIVE_STABLE_CLI_PREPARE_ONLY_FINAL_HOLD')
 def test_old_hengrui_china_id_is_rejected(self):
  for field in ('seed','cfg'):
   rows=fixture();rows[2]['prepared'][field]['sourceId']='source-hengrui-china-social'
   with self.subTest(field=field),self.assertRaises(AssertionError):validate(rows)
 def test_hengrui_cannot_reuse_either_predecessor_identity(self):
  for prior in (0,1):
   for key in ('roundId','batchId','launchChallenge','stateRoot'):
    rows=fixture()
    if key=='roundId':rows[2]['prepared'][key]=rows[prior]['prepared'][key]
    elif key=='stateRoot':rows[2][key]=rows[prior][key]
    else:rows[2]['prepared']['seed'][key]=rows[prior]['prepared']['seed'][key]
    with self.subTest(prior=prior,key=key),self.assertRaises(AssertionError):validate(rows)
 def test_exact_order_and_five_results_required(self):
  for mutate in (lambda r:r.pop(),lambda r:r.reverse(),lambda r:r.append(copy.deepcopy(r[2]))):
   rows=fixture();mutate(rows)
   with self.assertRaises(AssertionError):validate(rows)
 def test_ucb_cannot_reuse_any_predecessor_identity(self):
  for prior in (0,1,2):
   for key in ('roundId','batchId','launchChallenge','stateRoot'):
    rows=fixture()
    if key=='roundId':rows[3]['prepared'][key]=rows[prior]['prepared'][key]
    elif key=='stateRoot':rows[3][key]=rows[prior][key]
    else:rows[3]['prepared']['seed'][key]=rows[prior]['prepared']['seed'][key]
    with self.subTest(prior=prior,key=key),self.assertRaises(AssertionError):validate(rows)
 def test_ucb_cannot_use_a_different_source_id(self):
  for field in ('seed','cfg'):
   rows=fixture();rows[3]['prepared'][field]['sourceId']='source-ucb-social'
   with self.subTest(field=field),self.assertRaises(AssertionError):validate(rows)
 def test_viatris_cannot_reuse_any_of_four_predecessors(self):
  for prior in range(4):
   for key in ('roundId','batchId','launchChallenge','stateRoot'):
    rows=fixture()
    if key=='roundId':rows[4]['prepared'][key]=rows[prior]['prepared'][key]
    elif key=='stateRoot':rows[4][key]=rows[prior][key]
    else:rows[4]['prepared']['seed'][key]=rows[prior]['prepared']['seed'][key]
    with self.subTest(prior=prior,key=key),self.assertRaises(AssertionError):validate(rows)
 def test_viatris_exact_source_id_and_old_four_result_rejection(self):
  rows=fixture();self.assertEqual(rows[4]['prepared']['seed']['sourceId'],'source-viatris-social');validate(rows)
  with self.assertRaises(AssertionError):validate(rows[:4])
  for field in ('seed','cfg'):
   wrong=fixture();wrong[4]['prepared'][field]['sourceId']='source-ucb-china-social'
   with self.subTest(field=field),self.assertRaises(AssertionError):validate(wrong)
if __name__=='__main__':unittest.main()

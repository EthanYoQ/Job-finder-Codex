"""Prepare one TEST_ONLY full functions case; does not execute installation.
The resulting artifact uses the actual source/runtime gates and fixed-root
compiler mapping. GitHub/SQL tools must be synthetic in the separate runner.
Never execute this artifact with real official database tools.
"""
import hashlib,importlib.util,json,os,pathlib,runpy,sys
HERE=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def prepare(pins_path,out):
 pins_path=pathlib.Path(pins_path).resolve();out=pathlib.Path(out).resolve();out.mkdir(exist_ok=False)
 os.environ['INSTALL_TEST_PINS']=str(pins_path)
 spec=importlib.util.spec_from_file_location('test_full_functions_fixture',HERE/'test-bound-install.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 f=module.make_fixture();assert f['binding']['scope']['parent']==str(f['case']) and f['binding']['scope']['target']=='installed-disabled'
 assert f['case'].name.startswith('case-') and f['case'].parent.name=='lifecycle-cases'
 control=f['control'];source=f['source'];assert source.isascii()
 binding={'schemaVersion':1,**control,'holderSource':source,'holderSha256':sha(source.encode()),'retirementSql':(HERE/'post-retirement.sql').read_text(),'registrationSql':(HERE.parent/'functions/bootstrap-query.sql.template').read_text().replace('__JOBFINDER_CANDIDATE_ID__',control['expectedRow']['id'])}
 render=runpy.run_path(str(HERE/'render-install.py'))['render'];artifact=render(binding)
 artifact_path=out/'install.functions.TEST_ONLY.js';artifact_path.write_bytes(artifact);artifact_path.chmod(0o400)
 fixture={'kind':'TEST_ONLY_REAL_EXEC_SYNTHETIC_OFFICIAL_TOOLS','artifactPath':str(artifact_path),'artifactSha256':sha(artifact),'holderSourceSha256':sha(source.encode()),'holderSourceBytes':len(source),'case':str(f['case']),'target':str(f['target']),'owner':str(f['owner']),'control':control,'retirementTemplate':module.t.BASE['r'],'expectedProjectId':control['projectId'],'productionQualified':False,'runOnlyWithSyntheticOfficialTools':True}
 (out/'fixture.json').write_text(json.dumps(fixture,indent=2)+'\n');return fixture
if __name__=='__main__':
 assert len(sys.argv)==3;f=prepare(sys.argv[1],sys.argv[2]);print(json.dumps({'fixture':str(pathlib.Path(sys.argv[2]).resolve()/'fixture.json'),'case':f['case'],'holderSourceBytes':f['holderSourceBytes'],'artifactSha256':f['artifactSha256']}))

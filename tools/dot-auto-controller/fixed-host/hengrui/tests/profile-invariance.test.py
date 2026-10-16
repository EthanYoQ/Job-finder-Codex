"""Source-specific substitutions keep the exact c53 host/recovery lifecycle."""
from pathlib import Path
import json
P=Path(__file__).resolve().parents[1];HOST=P.parent
replacements=[('source-biogen-china-social','source-hengrui-social'),('company-biogen-china','company-hengrui'),('dot-cloud-biogen-china-social-pilot','dot-cloud-hengrui-social-pilot'),('47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348','93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e'),('Biogen','Hengrui'),('BIOGEN','HENGRUI'),('biogen','hengrui')]
files=['body.template.js','fixed-preimport-launch.py.in','fixed-preflight.mjs.in','fixed-recovery-helper.mts.in','bound-artifacts.py.in','activation-renderer.py','local-activation.py.in','lifecycle-activation.template.js','test-bound-install.py','test-derive-deployment.py','test-exercise-bound.py']
for name in files:
 expected=(HOST/'biogen'/name).read_text()
 for old,new in replacements:expected=expected.replace(old,new)
 assert expected==(P/name).read_text(),name+':unexpected shared lifecycle change'
assert (P/'functions-loader.js').read_bytes()==(HOST/'biogen/functions-loader.js').read_bytes()
print(json.dumps({'kind':'HENGRUI_PROFILE_ORIGINAL_LIFECYCLE_INVARIANCE','passed':True,'cases':len(files)+1,'files':files+['functions-loader.js'],'sourceSpecificSubstitutionsOnly':True,'productionCalls':0}))

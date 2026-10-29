set -eu
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.merck-stage-20261029T1804Z')
p.mkdir(exist_ok=True)
f=p/'part06'
with f.open('x') as out:out.write('QynqaefEyjJglFmCP3jWqtuvbhJNi+LQ6AfWErgYrG/mmAnI9RxUI1LXq86k+iFjoKcMyDcc035pF54WmfPnp40tGd0GXl5lvruSyQn/Nk7MKGXK7M+gV5CNvKSr+XVaUuGSp9hy9TF2Zq+VyiJLN5XVHAHRv7m8/n8BZ3cxJz4hAwA=')
print('STAGED_PART_06')
PY

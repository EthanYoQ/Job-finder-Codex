import json,pathlib,sys
files=list(pathlib.Path(sys.argv[1]).glob('artifacts/*.failure-*.json'))
if files:
 x=json.loads(files[-1].read_text()); crawl=x.get('crawlResult') or {}; observation=crawl.get('observation') or {}
 code=x.get('failureCode') or next((error.get('code') for error in (x.get('errors') or []) if error.get('code')),None)
 print(json.dumps({'failureCode':code,'phase':x.get('phase'),'reason':observation.get('completenessBlockerReason') or x.get('message') or x.get('errors'),'jobCount':len(crawl.get('jobs',[]))}))
else: print('Producer exited without a completed publication or failure artifact')

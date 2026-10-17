import json,pathlib,sys
files=list(pathlib.Path(sys.argv[1]).glob('artifacts/*.failure-*.json'))
if files:
 x=json.loads(files[-1].read_text()); crawl=x.get('crawlResult',{}); observation=crawl.get('observation',{})
 print(json.dumps({'failureCode':x.get('failureCode'),'phase':x.get('phase'),'reason':observation.get('completenessBlockerReason') or x.get('message'),'jobCount':len(crawl.get('jobs',[]))}))
else: print('Producer exited without a completed publication or failure artifact')

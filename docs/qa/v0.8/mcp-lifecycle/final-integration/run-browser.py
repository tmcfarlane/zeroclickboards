from pathlib import Path
import datetime,json,os,subprocess,sys,time
qa=Path(__file__).resolve().parent
repo=Path('/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci')
node='/private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node'
gate=sys.argv[1]
folder=qa/('browser-connectors' if gate=='connectors' else 'browser-toolbar')
command=[node,'node_modules/@playwright/test/cli.js','test','--config',str(folder/'playwright.config.mts')]
explicit={'CI':'true'}
if gate=='connectors':explicit['CONNECTOR_SCREENSHOT_DIR']=str(folder/'screenshots')
else:explicit['TOOLBAR_PHASE']='after'
env=os.environ.copy();env.update(explicit)
start=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.monotonic()
with (folder/'run.log').open('wb') as output:
 result=subprocess.run(command,cwd=repo,env=env,stdout=output,stderr=subprocess.STDOUT)
receipt={'gate':gate,'start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-clock,'exitCode':result.returncode,'command':command,'explicitEnvironment':explicit,'retries':0}
(folder/'execution.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt));sys.exit(result.returncode)

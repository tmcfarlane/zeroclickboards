from pathlib import Path
import datetime, json, os, subprocess, sys, time
qa=Path(__file__).resolve().parent
repo=Path("/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci")
node="/private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node"
gate=sys.argv[1]
commands={
"full-test":[node,"node_modules/vitest/vitest.mjs","run","--config",str(qa/"vite-test.config.mts"),"--maxWorkers=2","--reporter=default","--reporter=json","--outputFile.json="+str(qa/"full-test.json")],
"typecheck-app":[node,"node_modules/typescript/bin/tsc","--project","tsconfig.app.json","--incremental","false","--noEmit"],
"typecheck-node":[node,"node_modules/typescript/bin/tsc","--project","tsconfig.node.json","--incremental","false","--noEmit"],
"scoped-lint":[node,"node_modules/eslint/bin/eslint.js","--no-ignore","--max-warnings=0","api/_lib/__tests__/connector-lifecycle.test.ts","mcp-server/src/oauth-store.ts","mcp-server/src/oauth.ts","src/components/board/KanbanBoard.tsx","src/hooks/__tests__/useSignOutAction.test.tsx","src/hooks/useSignOutAction.ts"],
"build":[node,"node_modules/vite/bin/vite.js","build","--config",str(qa/"vite-build.config.mts")]
}
command=commands[gate]
env=os.environ.copy()
explicit={}
if gate=="full-test": explicit={"CI":"true","VITE_SUPABASE_URL":"https://placeholder.supabase.co","VITE_SUPABASE_ANON_KEY":"placeholder-key"}
if gate=="build": explicit={"VITE_SUPABASE_URL":"https://connector-fixture.invalid","VITE_SUPABASE_ANON_KEY":"disposable-fixture-public-key"}
env.update(explicit)
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
clock=time.monotonic()
with (qa/(gate+".log")).open("wb") as output:
 result=subprocess.run(command,cwd=repo,env=env,stdout=output,stderr=subprocess.STDOUT)
receipt={"gate":gate,"startedAt":started,"endedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"elapsedSeconds":time.monotonic()-clock,"exitCode":result.returncode,"command":command,"explicitEnvironment":explicit}
(qa/(gate+"-execution.json")).write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps(receipt))
sys.exit(result.returncode)

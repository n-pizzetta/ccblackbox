#!/bin/zsh
# Restarts the simulated live session (livesim.mjs) in the demo data, from a fresh context.
S=${0:A:h}; R=${S:h:h}; D=${CLAUDE_CONFIG_DIR:-$R/.demo-claude}; O=$R/.readme-rec
mkdir -p $O/bin && { [[ -x $O/bin/claude ]] || cc -o $O/bin/claude $S/fake-claude.c; }
pkill -f livesim.mjs; pkill -f "$O/bin/claude"
id=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).id)}catch{}' $O/live.out)
[[ -n $id ]] && rm -f $D/projects/*/$id.jsonl(N) $D/marey/live/$id.json
for f in $D/sessions/*.json(N); do [[ $f == */99991.json ]] || rm -f $f; done
(EVERY=${EVERY:-2500} node $S/livesim.mjs > $O/live.out 2>&1 &)
sleep 7

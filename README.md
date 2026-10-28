# pi-customisations
personal [pi-agent](http://pi.dev) extension that does two things
- render the session name (as per /tree) and a play/pause icon (indicating if agents/subagents running) in the terminal title
- chop everything out of the footer except the cost, context window percent consumed, and the tps

session names set with /name win over the /tree-derived default in both the title and the footer; clearing the name falls back to /tree again.

not sure if it'll explode without npm:pi-subagents but idc

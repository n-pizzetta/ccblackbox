#!/bin/zsh
# scripts/readme/togif.sh <name> [width] [fps]  → docs/readme/<name>.gif from the frames rec.mjs wrote
set -e
n=$1; w=${2:-1100}; f=${3:-15}
R=${0:A:h:h:h}
cd $R/.readme-rec/frames/$n
ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt -vf "fps=$f,scale=$w:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" $R/docs/readme/$n.gif

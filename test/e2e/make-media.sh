#!/bin/sh
# Generates the two test clips the mock server streams (needs ffmpeg).
cd "$(dirname "$0")" && mkdir -p media
ffmpeg -y -loglevel error -f lavfi -i testsrc2=size=1920x1080:rate=25 -f lavfi -i sine=frequency=440 -t 30 -c:v libx264 -preset veryfast -c:a ac3 media/live.ts
ffmpeg -y -loglevel error -f lavfi -i smptebars=size=1280x720:rate=25 -f lavfi -i sine=frequency=660 -t 20 -c:v libx264 -preset veryfast -c:a aac media/ep.mp4
echo "Done. Run: node test/e2e/mock-xtream.mjs  → log in with server 127.0.0.1:8099, user u, password pw"

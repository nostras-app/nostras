# Send an already-signed Nostr event, unchanged, to relays and print each OK.
# Usage: python3 -I rebroadcast.py event.json wss://relay1 wss://relay2 ...
# Use this instead of `nak event`, which re-signs its input.
import asyncio, json, sys, websockets
ev = json.load(open(sys.argv[1]))
async def send(url):
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            await ws.send(json.dumps(["EVENT", ev]))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if msg[0] == "OK" and msg[1] == ev["id"]:
                    return f"{url} OK={msg[2]} {msg[3]}"
    except Exception as e:
        return f"{url} ERROR {e!r}"
async def main():
    for r in await asyncio.gather(*(send(u) for u in sys.argv[2:])): print(r)
asyncio.run(main())

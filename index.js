const m3u8stream = require("m3u8stream");
const http = require("http");
const get = require("miniget");
const fs = require("fs");

// Repeaters
const rp = new Map();

// In order to avoid multiple pipe() call function that result memory leak,
// We're gonna use this stream repeater to broadcast a buffer to clients at the same time.
function createStreamRepeater(t, d) {
  // Clients
  let cs = new Set();

  function c(w) {
    cs.add(w);
    return w;
  }

  c.header = null; // Stream header. Used for revealing some comon info (like bitrate, etc)
  c.type = t; // Type
  c.ct = null; // Content type. Changed automatically
  c.d = d; // Description, if available

  // These are just FAKE functions.
  c.on = (_) => c;
  c.once = c.on;
  c.emit = c.on;
  c.unpipe = (w) => cs.delete(w);

  // Broadcast buffer functions.
  c.write = (d) => {
    if (!c.header) c.header = d;
    Buffer.isBuffer(d) &&
      cs.forEach((w) =>
        w.write(d, (e) => {
          if (e) cs.delete(w);
        })
      );
  };

  c.end = c.write; // Pretend that we ended the stream.

  // Yeah yeah, i know. what now?
  c.pipe = c;

  c.setCT = (ct) => (c.ct = ct);

  return c;
}

// This function should only used for Repeater stuff.
function getRepeater(i, t, d) {
  let repeater = rp.get(i);
  if (!repeater) {
    rp.set(i, createStreamRepeater(t, d));
    return getRepeater(i, t);
  }

  return repeater;
}

// playlistHandler()
// Used for livestreamer that use playlist like m3u or dash mpd.
function playlistHandler(s, i) {
  let repeater = getRepeater(s[0], "playlist", s.slice(3).join(" "));
  let stream = m3u8stream(s[1]);

  console.log(`R${i+1}: REPEATING....`);
  stream.pipe(repeater);

  stream.on("response", (res) => {
    if (res.headers["content-type"])
      repeater.setCT(res.headers["content-type"]);
  });
  stream.on("close", (_) => {
    console.log(`R${i+1}: RECONNECTING....`);
    playlistHandler(s, i);
  });

  stream.on("error", (err) => {
    console.error(`R${i+1}: ${err}`);
    stream.end();
  });
}

// rawHandler()
// Different than playlistHandler(), used to rebroadcast the coming buffers.
function rawHandler(s, i) {
  let repeater = getRepeater(s[0], "raw", s.slice(3).join(" "));
  let stream = get(s[1]);

  console.log(`R${i+1}: REPEATING....`);
  stream.pipe(repeater);

  stream.on("response", (res) => {
    if (res.headers["content-type"])
      repeater.setCT(res.headers["content-type"]);
  });
  stream.on("close", (_) => {
    console.log(`R${i+1}: RECONNECTING....`);
    rawHandler(s, i);
  });

  stream.on("error", (err) => {
    console.error(`R${i+1}: ${err}`);
    stream.end();
  });
}

rp.checkType = function (t, s, i) {
  switch (t) {
    case "playlist":
      playlistHandler(s, i);
      break;
    case "auto":
      // Detect Extension
      switch (s[1].split(".").pop()) {
        case "m3u8":
          return rp.checkType("playlist", s, i);
          break;
        case "m3u8":
          return rp.checkType("playlist", s, i);
          break;
        case "mpd":
          return rp.checkType("playlist", s, i);
          break;
        default:
          return rp.checkType("raw", s, i);
          break;
      }
      break;
    default:
      if (t != "raw")
        console.warn(`R${i+1}: Unknown Stream type (${t}). Marking as "raw"`);
      rawHandler(s, i);
      break;
  }

  console.log(`R${i+1}: Loaded repeater for ${s[0]} endpoint`);
};

// Read the URL file
// Then parse them all.
let streams = fs
  .readFileSync(process.argv.slice(2)[0] || __dirname + "/URLs.txt", "utf8")
  .split("\n")
  .filter((l) => l.length && !l.startsWith("#"))
  .map((l) => l.split(" "));

console.log(`Loading ${streams.length} repeater....`);

streams.forEach((s, i) => {
  if (s.length < 3) return console.warn(`R${i + 1}: Invalid Format. Skipping`);

  // Check stream type, and format them
  rp.checkType(s[0].toLowerCase(), s.slice(1), i);
});

http
  .createServer((req, res) => {
    let stream = rp.get(req.url.split("?")[0]);

	if (stream) {
    	if (stream.ct) res.setHeader("content-type", stream.ct);
    	if (stream.type === "raw" && stream.header) res.write(stream.header);
    	stream.pipe(res);
    } else if (!stream && !process.env.NO_LIST && req.url.split("?")[0] === "/") {
    	res.setHeader("content-type", "text/plain");
    	res.write("node-live-repeater - A livestream repeater - https://github.com/Yonle/live-repeater\n");
    	res.write(`This server is running node-live-repeater which is repeating ${streams.length} livestream right now\n`);
    	res.write("\nEndpoints:\n");
    	rp.forEach(({ d }, e) => {
    		res.write(`${e}: ${d || "No description."}\n`);
    	});
    	res.end();
    } else {
    	return res.writeHead(404).end();
    }
  })
  .listen(process.env.PORT || 8080, (_) =>
    console.log("Listening at", process.env.PORT || 8080)
  );

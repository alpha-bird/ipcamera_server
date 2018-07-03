var kurento = require('kurento-client');
var express = require('express');
var router = express.Router();
var app = express();
var path = require('path');
var url = require('url');
var wsm = require('ws');
var fs    = require('fs');
var https = require('https');
var http = require('http');

app.set('port', process.env.PORT || 8080);

/*
 * Definition of constants
 */

const ws_uri = "ws://54.196.144.251:8888/kurento";
const rtsp_uri = "rtsp://xtorr.wellchecked.net:554/live2.sdp";
/*
 * Definition of global variables.
 */

var idCounter = 0;
var candidatesQueue = {};
var master = null;
var pipeline = null;
var viewers = {};
var kurentoClient = null;
var playerEndpoint = null;

var streamNames = [];
var activePipelines = {};
var activePlayerendpoints = {};

function nextUniqueId() {
	idCounter++;
	return idCounter.toString();
}
/*
 * Server startup
 */

var port = app.get('port');

var options =
{
	key:  fs.readFileSync('keys/server.key'),
	cert: fs.readFileSync('keys/server.crt')
};

var server = http.createServer( app ).listen(port, function() {
    console.log('Kurento Media Server started');
    //console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var WebSocketServer = wsm.Server, wss = new WebSocketServer({
	server : server,
	path : '/one2many'
});
/*
var streamName
// Master Stream hasn't been set
startRTSP(streamName, function(error) {
	console.log('**********************startRTSP(function(error) {');
	if (error) {
		return console.error(error);
	}
});
*/
function isStreamExisted(streamName) {
	for(var i = 0; i < streamNames.length; i ++ ) {
		if( streamNames[i] === streamName ) return true
	}
	return false
}
/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {

	var sessionId = nextUniqueId();

	console.log('************************Connection received with sessionId ' + sessionId);

	ws.on('error', function(error) {
		console.log('*********************Connection ' + sessionId + ' error');
		stop(sessionId);
	});

	ws.on('close', function() {
		console.log('**************************Connection ' + sessionId + ' closed');
		stop(sessionId);
	});

	ws.on('message', function(_message) {
		var message = JSON.parse(_message);
		console.log('*************************Connection ' + sessionId + ' received message ', message);

		switch (message.id) {
			case 'initialize':
				if( isStreamExisted(message.streamName) ) {
					ws.send(JSON.stringify({
						id : 'initializeResponse',
						response : 'already playing'
					}));
				}
				else {
					startRTSP(message.streamName, (err) => {
						if(err) {
							return console.log('Stopped RTSP with errors', err)
						}
						ws.send(JSON.stringify({
							id : 'initializeResponse',
							response : 'ready'
						}));
					})
				}
				break;
			case 'viewer':
				startViewer(sessionId, message.sdpOffer, message.streamName, ws, function(error, sdpAnswer) {
					if (error) {
						return ws.send(JSON.stringify({
							id : 'viewerResponse',
							response : 'rejected',
							message : error
						}));
					}

					ws.send(JSON.stringify({
						id : 'viewerResponse',
						response : 'accepted',
						sdpAnswer : sdpAnswer
					}));
				});
				break;

			case 'stop':
				stop(sessionId);
				break;
				
			case 'onIceCandidate':
				onIceCandidate(sessionId, message.candidate);
				break;

			default:
				ws.send(JSON.stringify({
					id : 'error',
					message : 'Invalid message ' + message
				}));
				break;
		}
	});
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
	if (kurentoClient !== null) {
		return callback(null, kurentoClient);
	}

	kurento(ws_uri, function(error, _kurentoClient) {
		if (error) {
			console.log("*******************Coult not find media server at address " + ws_uri);
			return callback("Could not find media server at address" + ws_uri
					+ ". Exiting with error " + error);
		}

		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
}

/* Start PlayerEndpoint instead */
function startRTSP(streamName, callback) {
	console.log('Starting RTSP ......');

	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			stop(id);
			return console.error('Error occured in getKurentoClient(function(error, kurentoClient)', error);
		}
		kurentoClient.create('MediaPipeline', function(error, _pipeline) {
			if (error) {
				return console.error("Error occured in kurentoClient.create('MediaPipeline', function(error, _pipeline)", error);
			}

			// PlayerEndpoint params
			var params = {
				//mediaPipeline: _pipeline,
				uri: streamName,
				useEncodedMedia: false // true
			};

			//pipeline = _pipeline;
			activePipelines[streamName] = _pipeline
			activePipelines[streamName].create('PlayerEndpoint', params, function(error, _playerEndpoint) {
				if (error) {
					console.error("Error**************pipeline.create('PlayerEndpoint', params, function(error, PlayerEndpoint) {");
					//return callback(error);
					return
				}
				//playerEndpoint = _playerEndpoint;
				activePlayerendpoints[streamName] = _playerEndpoint

				console.log(`Preparing ${streamName} to play .... `);
				
				activePlayerendpoints[streamName].play(function(error) {
					if (error) {
						console.error("Error**************playerEndpoint.play(function(error) {");
						//return callback(error);
						return;
					}
					streamNames.push(streamName)
					console.log('Playing ... ');
					return callback(null)
				});

			});

		});
	});
}

function startViewer(id, sdp, streamName, ws, callback) {
	console.log('***************startViewer(id, sdp, ws, callback) {');
	/*
	if (master === null || master.webRtcEndpoint === null) {
		console.error("Error**************No active streams available. Try again later ...");
		return callback("No active streams available. Try again later ...");
	}
*/
	if (viewers[id]) {
		console.error("Error**************You are already viewing in this session. Use a different browser to add additional viewers.");
		return callback("You are already viewing in this session. Use a different browser to add additional viewers.")
	}
	
	activePipelines[streamName].create('WebRtcEndpoint', function(error, webRtcEndpoint) {
		console.log("**************pipeline.create('WebRtcEndpoint',");
		if (error) {
			console.error("Error**************pipeline.create('WebRtcEndpoint.");
			return callback(error);
		}
/*
		if (master === null) {
			stop(id);
			console.error("Error**************No active streams available. Try again later ...");
			return callback("No active streams available. Try again later ...");
		}
*/		
		
		var viewer = {
			id : id,
			ws : ws,
			webRtcEndpoint : webRtcEndpoint
		};
		viewers[viewer.id] = viewer;

		//master = {webRtcEndpoint: webRtcEndpoint};
		
		if (candidatesQueue[id]) {
			while(candidatesQueue[id].length) {
				var candidate = candidatesQueue[id].shift();
				webRtcEndpoint.addIceCandidate(candidate);
			}
		}

        webRtcEndpoint.on('OnIceCandidate', function(event) {
			console.log("**************webRtcEndpoint.on('OnIceCandidate', function(event) {");
            var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            ws.send(JSON.stringify({
                id : 'iceCandidate',
                candidate : candidate
            }));
        });
		
		webRtcEndpoint.processOffer(sdp, function(error, sdpAnswer) {
			console.log("**************webRtcEndpoint.processOffer(sdp,");
			if (error) {
				stop(id);
				console.error("Error**************webRtcEndpoint.processOffer(sdp,");
				return callback(error);
			}
			/*
			if (master === null) {
				stop(id);
				console.error("Error**************No active streams available. Try again later ...");
				return callback("No active streams available. Try again later ...");
			}*/

			//master.webRtcEndpoint.connect(webRtcEndpoint, function(error) {
			activePlayerendpoints[streamName].connect(webRtcEndpoint, function(error) {
				console.log("**************master.webRtcEndpoint.connect(webRtcEndpoint");
				if (error) {
					stop(id);
					console.error("Error**************master.webRtcEndpoint.connect(webRtcEndpoint");
					return callback(error, getState4Client());
				}
				/*
				if (master === null) {
					stop(id);
					console.error("Error**************No active sender now. Become sender or . Try again later ...");
					return callback("No active sender now. Become sender or . Try again later ...");
				}*/

				/*var viewer = {
					id : id,
					ws : ws,
					webRtcEndpoint : webRtcEndpoint
				};
				viewers[viewer.id] = viewer;*/

				return callback(null, sdpAnswer);
			});
		});
		webRtcEndpoint.gatherCandidates(function(error) {
			if (error) {
				stop(sessionId);
				return callback(error);
			}
		});
	});
}

function clearCandidatesQueue(sessionId) {
	if (candidatesQueue[sessionId]) {
		delete candidatesQueue[sessionId];
	}
}

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.register.complexTypes.IceCandidate(_candidate);

    /*if (presenter && presenter.id === sessionId && presenter.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        presenter.webRtcEndpoint.addIceCandidate(candidate);
    }*/
	
	/*if (master && master.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        master.webRtcEndpoint.addIceCandidate(candidate);
    }
    else*/ if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
        console.info('***************Sending viewer candidate');
        viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

function stop(id) {
	if (viewers[id]) {
		var viewer = viewers[id];
		if (viewer.webRtcEndpoint)
			viewer.webRtcEndpoint.release();
		delete viewers[id];
/*
		if(pipeline) pipeline.release();
		pipeline = null;
		master = null;

		startRTSP(function(error) {
			console.log('**********************startRTSP(function(error) {');
			if (error) {
				return console.error(error);
			}
		});*/
	}
	clearCandidatesQueue(id);
}

app.use(express.static(path.join(__dirname, 'static')));
app.use(router);

router.get('/embed_player', (req, res, next) => {
	var streamName = req.query.streamName
	var method = req.query.method
	res.send(`<video src="http://clips.vorwaerts-gmbh.de/VfE_html5.mp4" width = "100%" height="100%" controls></video>`)
})
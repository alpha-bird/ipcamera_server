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

const ws_uri = "ws://localhost:8888/kurento";

/*
 * Definition of global variables.
 */

var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;

var viewers = {};
var activeStreamNames = [];
var activePipelines = {};
var activePlayerEndpoints = {};
var numberOfUser = {};

function nextUniqueId() {
	idCounter++;
	return idCounter.toString();
}
/*
 * Server startup
 */

var port = app.get('port');
/*
var server = app.listen(port, function() {
	console.log('Express server started ');
	console.log('Connect to http://<host_name>:' + port + '/');
});*/

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
	path : '/many2many'
});

/*
 * Management of WebSocket messages
 */
function isStreamExisted(streamName) {
	for(var i = 0; i < activeStreamNames.length; i ++ ) {
		if( activeStreamNames[i] === streamName ) return true
	}
	return false
}

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
			if( message.streamName ) {
				if ( isStreamExisted(message.streamName) ) {
					ws.send(JSON.stringify({
						id : 'initializeResponse',
						response : 'already playing'
					}));
				}
				else {
					startRTSP(message.streamName, (err) => {
						if(err) {
							return console.log('Error occured in Starting RTSP', err)
						}
						ws.send(JSON.stringify({
							id : 'initializeResponse',
							response : 'ready'
						}));
					});
				}
			}
			else {
				ws.send(JSON.stringify({
					id : 'initializeResponse',
					response : 'not ready'
				}));
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
				numberOfUser[message.streamName] = numberOfUser[message.streamName] ? numberOfUser[message.streamName] + 1 : 1
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
	console.log('********************function startRTSP(callback) {');
	
	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			stop(id);
			console.error('Error**************getKurentoClient(function(error, kurentoClient) {');
			//return callback(error);
			return;
		}
		kurentoClient.create('MediaPipeline', function(error, _pipeline) {
			if (error) {
				console.error("Error**************kurentoClient.create('MediaPipeline', function(error, _pipeline) {");
				//return callback(error);
				return;
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
				activePlayerEndpoints[streamName] = _playerEndpoint
				console.log(`Preparing ${streamName} to play ...`);
				activePlayerEndpoints[streamName].play(function(error) {
					if (error) {
						console.error("Error**************playerEndpoint.play(function(error) {");
						//return callback(error);
						return;
					}
					activeStreamNames.push(streamName)
					console.log('Playing ...');
					callback(null)
				});

			});

		});
	});
}

function startViewer(id, sdp, streamName, ws, callback) {
	console.log('***************startViewer(id, sdp, ws, callback) {');

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
		
		var viewer = {
			id : id,
			ws : ws,
			webRtcEndpoint : webRtcEndpoint,
			streamName : streamName
		};
		viewers[viewer.id] = viewer;
		
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

			activePlayerEndpoints[streamName].connect(webRtcEndpoint, function(error) {
				console.log("**************master.webRtcEndpoint.connect(webRtcEndpoint");
				if (error) {
					stop(id);
					console.error("Error**************master.webRtcEndpoint.connect(webRtcEndpoint");
					return callback(error, getState4Client());
				}

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

	if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
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
		if (viewer.streamName ) {
			numberOfUser[viewer.streamName] = numberOfUser[viewer.streamName] - 1
			if( numberOfUser[viewer.streamName] === 0 ) {
				var index = activeStreamNames.findIndex( (value) => {
					if(value === viewer.streamName) return true
					return false
				})
				activeStreamNames.splice(index, 1)
				if(activePipelines[viewer.streamName]) activePipelines[viewer.streamName].release()
				delete activePipelines[viewer.streamName];
				delete activePlayerEndpoints[viewer.streamName];
			}
		}
		delete viewers[id];
		console.log(viewers)
		console.log(activePipelines)
		console.log(activePlayerEndpoints)
		console.log(activeStreamNames)
	}
	clearCandidatesQueue(id);
}
app.use(express.static(path.join(__dirname, 'static')));
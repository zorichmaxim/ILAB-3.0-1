var fs = useSystem('fs');
var JsonSocket = useModule('jsonsocket');
var net = useSystem('net');
var Path = useSystem('path');
var EventEmitter = useSystem('events');
var util = useModule('utils');
var ServiceProxy = useRoot('System/ServiceProxy');

Service = function(params){
    var self = this;
    this.serviceId = Frame.serviceId;
    this.port = Frame.servicePort;
    this.server = net.createServer({
        allowHalfOpen: false,
        pauseOnConnect: false
    }, this._onConnection.bind(this));
    try {
        this.server.listen(this.port, function () {
            console.log(self.serviceId + ":" + self.port);
        });
    }
    catch (error){
        throw ("Cannot start " + this.serviceId + " on " + this.port + "\n" + error.message);
    }
    return EventEmitter.call(this);
};

Service.CreateProxyObject = function (service) {
    if (!service) return {};
    var obj = { serviceId : service.serviceId };
    for (var item in service){
        if (item.indexOf("_") != 0 && typeof (service[item]) == "function" && service.hasOwnProperty(item)){
            obj[item] = "method";
        }
    }
    return obj;
};

Inherit(Service, EventEmitter, {
    _callMethod : function (name, args){
        if (typeof this[name] == "function"){
            return this[name].apply(this, args);
        }
        this.emit("error", new Error(this.serviceId + ":" + this.port + ":" + name + " proxy called undefined method"));
        return undefined;
    },

    _onConnection  : function(socket){
        var self = this;
        var handshakeFinished = false;
        //console.log(this.serviceId + ":" + this.port + " connection");
        socket = new JsonSocket(socket);

        var errorHandler = function(err){
            self.emit("error", err);
        };
        socket.on("error", errorHandler);
        var messageHandlerFunction = function (message) {
            if (message.type == "method"){
                var result = self._callMethod(message.name, message.args);
                if (result instanceof Promise){
                    result.then(function (result) {
                        try {
                            socket.write({"type": "result", id: message.id, result: result});
                        }
                        catch (error){
                            throw error;
                        }
                    }).catch(function (error) {
                        if (typeof error == "string") {
                            socket.write({"type": "error", id: message.id, result: error});
                        }
                        else {
                            socket.write({"type": "error", id: message.id, result: error.message, stack: error.stack});
                        }
                    });
                }
                else {
                    if (message.id) {
                        socket.write({"type": "result", id: message.id, result: result})
                    }
                }
            }
        };
        socket.once("json", function (startupMessage) {
            handshakeFinished = true;
        });
        var internalEventHandler = function (eventName, args) {
            if (handshakeFinished){
                socket.write({ type: "event", name : eventName, args : args});
            }
        };
        self.on("internal-event", internalEventHandler);
        socket.on("json", messageHandlerFunction);
        socket.once("close", function (isError) {
            self.removeListener("internal-event", internalEventHandler);
            this.removeListener("json", messageHandlerFunction);
            this.removeListener("error", errorHandler);
        });
        var proxy = Service.CreateProxyObject(this);
        socket.write(proxy);
    },

    emit: function (eventName) {
        if (eventName != "error" && eventName != "internal-event") {
            Service.base.emit.call(this, "internal-event", eventName, Array.from(arguments));
        }
        Service.base.emit.apply(this, arguments);
    }
});

module.exports = Service;
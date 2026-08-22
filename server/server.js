const express = require("express");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Add the path parameter so Railway routes the handshake correctly
const wss = new WebSocket.Server({ server });


const PORT = process.env.PORT || 3000;


app.get("/", (req, res) => {
    res.redirect("index.html");
});


// =========================================================
// SERVE CIRCUIT MAKER 2
// =========================================================

app.use(
    express.static(
        path.join(__dirname, "..")
    )
);


// =========================================================
// ROOM STORAGE
// =========================================================

const rooms = new Map();


// =========================================================
// ROOM CODE GENERATOR
// =========================================================

function generateRoomCode() {

    // Avoid confusing characters like O, 0, I, and 1
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 5; i++) {

        code += chars[
            crypto.randomInt(
                0,
                chars.length
            )
        ];
    }

    return code;
}


function generateRoomId() {

    let code;

    do {

        code = generateRoomCode();

    } while (rooms.has(code));

    return code;
}


// =========================================================
// PASSWORD HASHING
// =========================================================

function hashPassword(password) {

    const salt =
        crypto
            .randomBytes(16)
            .toString("hex");


    const hash =
        crypto
            .scryptSync(
                password,
                salt,
                32
            )
            .toString("hex");


    return {
        salt,
        hash
    };
}


function verifyPassword(
    password,
    room
) {

    const testHash =
        crypto
            .scryptSync(
                password,
                room.passwordSalt,
                32
            )
            .toString("hex");


    return crypto.timingSafeEqual(
        Buffer.from(
            testHash,
            "hex"
        ),

        Buffer.from(
            room.passwordHash,
            "hex"
        )
    );
}


// =========================================================
// DEFAULT CIRCUIT
// =========================================================

function createEmptyCircuit() {

    return {
        nodes: {},
        wires: [],
        nodeCounter: 0
    };
}


// =========================================================
// SEND MESSAGE TO ONE CLIENT
// =========================================================

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );
    }
}


// =========================================================
// BROADCAST TO ROOM
// =========================================================

function broadcastRoom(
    room,
    data,
    except = null
) {

    for (
        const client of room.clients
    ) {

        if (
            client !== except &&
            client.readyState ===
                WebSocket.OPEN
        ) {

            client.send(
                JSON.stringify(data)
            );
        }
    }
}


// =========================================================
// CREATE ROOM
// =========================================================

function createRoom(
    password,
    ownerSocket
) {

    const code =
        generateRoomId();


    const passwordInfo =
        hashPassword(password);


    const room = {

        code,

        passwordSalt:
            passwordInfo.salt,

        passwordHash:
            passwordInfo.hash,

        owner:
            ownerSocket,

        clients:
            new Set([
                ownerSocket
            ]),

        circuit:
            createEmptyCircuit()
    };


    rooms.set(
        code,
        room
    );


    ownerSocket.roomCode =
        code;


    return room;
}


// =========================================================
// CLEAN EMPTY ROOM
// =========================================================

function cleanupRoom(room) {

    if (
        room.clients.size === 0
    ) {

        rooms.delete(
            room.code
        );


        console.log(
            `Room ${room.code} deleted.`
        );
    }
}


// =========================================================
// WEBSOCKET CONNECTION
// =========================================================

wss.on(
    "connection",
    (ws) => {

        console.log(
            "Client connected."
        );


        // Information belonging to this
        // particular browser connection.

        ws.roomCode = null;

        ws.userId = null;


        // -------------------------------------------------
        // RECEIVE MESSAGE
        // -------------------------------------------------

        ws.on(
            "message",
            (rawMessage) => {

                let message;


                // -----------------------------------------
                // Parse JSON
                // -----------------------------------------

                try {

                    message =
                        JSON.parse(
                            rawMessage.toString()
                        );

                } catch {

                    send(
                        ws,
                        {
                            type: "ERROR",
                            message:
                                "Invalid message."
                        }
                    );

                    return;
                }


                // =========================================
                // CREATE ROOM
                // =========================================

                if (
                    message.type ===
                    "CREATE_ROOM"
                ) {

                    const password =
                        String(
                            message.password ||
                            ""
                        );


                    const userId =
                        String(
                            message.userId ||
                            ""
                        );


                    if (
                        password.length < 1
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "A room password is required."
                            }
                        );

                        return;
                    }


                    if (
                        ws.roomCode
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "You are already in a room."
                            }
                        );

                        return;
                    }


                    // Store user ID for later
                    // collaboration features.

                    ws.userId =
                        userId ||
                        crypto.randomUUID();


                    const room =
                        createRoom(
                            password,
                            ws
                        );


                    send(
                        ws,
                        {
                            type:
                                "ROOM_CREATED",

                            roomCode:
                                room.code,

                            circuit:
                                room.circuit,

                            userRole:
                                "owner"
                        }
                    );


                    console.log(
                        `Room created: ${room.code}`
                    );


                    return;
                }


                // =========================================
                // JOIN ROOM
                // =========================================

                if (
                    message.type ===
                    "JOIN_ROOM"
                ) {

                    const roomCode =
                        String(
                            message.roomCode ||
                            ""
                        )
                        .toUpperCase();


                    const password =
                        String(
                            message.password ||
                            ""
                        );


                    const userId =
                        String(
                            message.userId ||
                            ""
                        );


                    const room =
                        rooms.get(
                            roomCode
                        );


                    if (!room) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "Room not found."
                            }
                        );

                        return;
                    }


                    if (
                        !verifyPassword(
                            password,
                            room
                        )
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "Incorrect password."
                            }
                        );

                        return;
                    }


                    if (
                        ws.roomCode
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "You are already in a room."
                            }
                        );

                        return;
                    }


                    // Store user's ID.

                    ws.userId =
                        userId ||
                        crypto.randomUUID();


                    room.clients.add(
                        ws
                    );


                    ws.roomCode =
                        room.code;


                    // Send current circuit
                    // to newly joined user.

                    send(
                        ws,
                        {
                            type:
                                "ROOM_JOINED",

                            roomCode:
                                room.code,

                            circuit:
                                room.circuit,

                            userRole:
                                "member"
                        }
                    );


                    // Tell everyone else
                    // somebody joined.

                    broadcastRoom(
                        room,
                        {
                            type:
                                "USER_JOINED",

                            participantCount:
                                room.clients.size
                        },
                        ws
                    );


                    console.log(
                        `Client joined room ${room.code}`
                    );


                    return;
                }


                // =========================================
                // CIRCUIT STATE UPDATE
                // =========================================

                if (
                    message.type ===
                    "STATE_UPDATE"
                ) {

                    if (
                        !ws.roomCode
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "You are not in a room."
                            }
                        );

                        return;
                    }


                    const room =
                        rooms.get(
                            ws.roomCode
                        );


                    if (!room) {
                        return;
                    }


                    // Validate that we received
                    // an object.

                    if (
                        !message.circuit ||
                        typeof message.circuit !==
                            "object"
                    ) {

                        send(
                            ws,
                            {
                                type: "ERROR",

                                message:
                                    "Invalid circuit state."
                            }
                        );

                        return;
                    }


                    // Server becomes the shared
                    // source of truth.

                    room.circuit =
                        message.circuit;


                    // Send the new circuit
                    // to everyone else.

                    broadcastRoom(
                        room,
                        {
                            type:
                                "STATE_UPDATE",

                            circuit:
                                room.circuit
                        },
                        ws
                    );


                    return;
                }


                // =========================================
                // LEAVE ROOM
                // =========================================

                if (
                    message.type ===
                    "LEAVE_ROOM"
                ) {

                    leaveRoom(ws);

                    return;
                }
            }
        );


        // -------------------------------------------------
        // CONNECTION CLOSED
        // -------------------------------------------------

        ws.on(
            "close",
            () => {

                leaveRoom(ws);

                console.log(
                    "Client disconnected."
                );
            }
        );


        // -------------------------------------------------
        // CONNECTION ERROR
        // -------------------------------------------------

        ws.on(
            "error",
            (error) => {

                console.error(
                    "WebSocket error:",
                    error
                );
            }
        );
    }
);


// =========================================================
// LEAVE ROOM
// =========================================================

function leaveRoom(ws) {

    if (
        !ws.roomCode
    ) {

        return;
    }


    const room =
        rooms.get(
            ws.roomCode
        );


    if (!room) {

        ws.roomCode = null;

        return;
    }


    // Remove client.

    room.clients.delete(
        ws
    );


    // Tell everyone remaining
    // that somebody left.

    broadcastRoom(
        room,
        {
            type:
                "USER_LEFT",

            userId:
                ws.userId,

            participantCount:
                room.clients.size
        }
    );


    // -----------------------------------------------------
    // If owner leaves, transfer ownership
    // -----------------------------------------------------

    if (
        room.owner === ws
    ) {

        const nextOwner =
            room.clients
                .values()
                .next()
                .value;


        room.owner =
            nextOwner || null;


        if (room.owner) {

            send(
                room.owner,
                {
                    type:
                        "OWNER_CHANGED"
                }
            );
        }
    }


    ws.roomCode = null;

    ws.userId = null;


    cleanupRoom(
        room
    );
}


// =========================================================
// START SERVER
// =========================================================

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            "       CIRCUIT MAKER 2 SERVER"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Server running at: http://localhost:${PORT}`
        );

        console.log(
            "WebSocket collaboration is enabled."
        );

        console.log(
            "======================================"
        );

        console.log("");
    }
);

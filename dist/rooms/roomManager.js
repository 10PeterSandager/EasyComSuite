"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomManager = void 0;
class RoomManager {
    constructor() {
        this.rooms = new Map();
    }
    joinRoom(roomId, peerId, role, companyId) {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = {
                id: roomId,
                companyId,
                peers: new Map(),
                talkbackOwner: undefined,
                videoSlots: {}
            };
            this.rooms.set(roomId, room);
        }
        const peer = { id: peerId, role, companyId };
        room.peers.set(peerId, peer);
    }
    leaveRoom(roomId, peerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        room.peers.delete(peerId);
        if (room.talkbackOwner === peerId) {
            room.talkbackOwner = undefined;
        }
        for (const slot of ["A", "B", "C", "D"]) {
            if (room.videoSlots[slot] === peerId) {
                delete room.videoSlots[slot];
            }
        }
        if (room.peers.size === 0) {
            this.rooms.delete(roomId);
        }
    }
    requestTalkback(roomId, peerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            throw new Error("Room not found");
        if (!room.peers.has(peerId))
            throw new Error("Peer not in room");
        if (room.talkbackOwner && room.talkbackOwner !== peerId)
            throw new Error("Talkback already locked");
        room.talkbackOwner = peerId;
    }
    releaseTalkback(roomId, peerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        if (room.talkbackOwner === peerId) {
            room.talkbackOwner = undefined;
        }
    }
    setVideoSlot(roomId, slot, targetPeerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            throw new Error("Room not found");
        if (!room.peers.has(targetPeerId))
            throw new Error("Target peer not in room");
        room.videoSlots[slot] = targetPeerId;
    }
    getSerializedState(roomId) {
        const room = this.rooms.get(roomId);
        if (!room)
            throw new Error("Room not found");
        return {
            id: room.id,
            companyId: room.companyId,
            peers: Array.from(room.peers.values()).map(p => ({
                id: p.id,
                role: p.role
            })),
            talkbackOwner: room.talkbackOwner,
            videoSlots: { ...room.videoSlots }
        };
    }
}
exports.roomManager = new RoomManager();
//# sourceMappingURL=roomManager.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGroup = createGroup;
exports.getGroup = getGroup;
exports.getGroups = getGroups;
const groups = [];
function createGroup(group) {
    groups.push(group);
}
function getGroup(id) {
    return groups.find(g => g.id === id);
}
function getGroups() {
    return groups;
}
//# sourceMappingURL=groups.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EchoCanceller = void 0;
class EchoCanceller {
    constructor() {
        this.filterLength = 128;
        this.filters = new Map();
        this.reference = new Map();
        this.mu = 0.0005;
    }
    getFilter(clientId) {
        let f = this.filters.get(clientId);
        if (!f) {
            f = new Float32Array(this.filterLength);
            this.filters.set(clientId, f);
        }
        return f;
    }
    setReference(clientId, ref) {
        this.reference.set(clientId, ref);
    }
    process(clientId, mic) {
        const ref = this.reference.get(clientId);
        if (!ref)
            return mic;
        const filter = this.getFilter(clientId);
        const out = new Float32Array(mic.length);
        for (let n = 0; n < mic.length; n++) {
            let echo = 0;
            for (let k = 0; k < this.filterLength && n - k >= 0; k++) {
                echo += filter[k] * ref[n - k];
            }
            const e = mic[n] - echo;
            out[n] = e;
            for (let k = 0; k < this.filterLength && n - k >= 0; k++) {
                filter[k] += this.mu * e * ref[n - k];
            }
        }
        return out;
    }
    removeClient(clientId) {
        this.filters.delete(clientId);
        this.reference.delete(clientId);
    }
}
exports.EchoCanceller = EchoCanceller;
//# sourceMappingURL=EchoCanceller.js.map
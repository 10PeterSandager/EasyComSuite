"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMixer = createMixer;
/// <reference lib="dom" />
function createMixer(ctx) {
    const gain = ctx.createGain();
    const eq = ctx.createBiquadFilter();
    const comp = ctx.createDynamicsCompressor();
    gain.connect(eq);
    eq.connect(comp);
    comp.connect(ctx.destination);
    return {
        addStream(stream) {
            const src = ctx.createMediaStreamSource(stream);
            src.connect(gain);
        },
        setGain(v) {
            gain.gain.value = v;
        },
        setEQ(freq, g) {
            eq.frequency.value = freq;
            eq.gain.value = g;
        },
        setGate(threshold) {
            comp.threshold.value = threshold;
        }
    };
}
//# sourceMappingURL=AudioMixer.js.map
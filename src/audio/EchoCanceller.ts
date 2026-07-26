export class EchoCanceller {

  private filterLength = 128

  private filters = new Map<string, Float32Array>()
  private reference = new Map<string, Float32Array>()

  private mu = 0.0005

  private getFilter(clientId: string): Float32Array {

    let f = this.filters.get(clientId)

    if (!f) {
      f = new Float32Array(this.filterLength)
      this.filters.set(clientId, f)
    }

    return f
  }

  setReference(clientId: string, ref: Float32Array) {

    this.reference.set(clientId, ref)

  }

  process(clientId: string, mic: Float32Array): Float32Array {

    const ref = this.reference.get(clientId)

    if (!ref) return mic

    const filter = this.getFilter(clientId)

    const out = new Float32Array(mic.length)

    for (let n = 0; n < mic.length; n++) {

      let echo = 0

      for (let k = 0; k < this.filterLength && n - k >= 0; k++) {
        echo += filter[k] * ref[n - k]
      }

      const e = mic[n] - echo

      out[n] = e

      for (let k = 0; k < this.filterLength && n - k >= 0; k++) {
        filter[k] += this.mu * e * ref[n - k]
      }

    }

    return out

  }

  removeClient(clientId: string) {

    this.filters.delete(clientId)
    this.reference.delete(clientId)

  }

}
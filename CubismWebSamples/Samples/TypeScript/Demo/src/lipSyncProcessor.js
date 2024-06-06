class LipSyncProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._volume = 0;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    if (event.data === 'reset') {
      this._volume = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      this._volume = Math.sqrt(sum / channelData.length);
      this.port.postMessage(this._volume);
    }
    return true;
  }
}

registerProcessor('lip-sync-processor', LipSyncProcessor);

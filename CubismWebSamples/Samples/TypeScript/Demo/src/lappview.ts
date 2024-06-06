import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';
import * as LAppDefine from './lappdefine';
import { LAppDelegate } from './lappdelegate';
import { canvas, gl } from './lappglmanager';
import { LAppLive2DManager } from './lapplive2dmanager';
import { LAppPal } from './lapppal';
import { LAppSprite } from './lappsprite';
import { TextureInfo } from './lapptexturemanager';
import { TouchManager } from './touchmanager';

export class LAppView {
  private _touchManager: TouchManager;
  private _deviceToScreen: CubismMatrix44;
  private _viewMatrix: CubismViewMatrix;
  private _programId: WebGLProgram | null;
  private _back: LAppSprite | null;
  private _next: LAppSprite | null;
  private _previous: LAppSprite | null;
  private _mic: LAppSprite | null;
  private _micActive: LAppSprite | null;
  private _isRecording: boolean;
  private _recognition: SpeechRecognition | null;
  private _voices: SpeechSynthesisVoice[] = [];
  private _selectedVoice: SpeechSynthesisVoice | null = null;
  private _audioContext: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _javascriptNode: AudioWorkletNode | null = null;
  private _audioDataArray: Uint8Array | null = null;

  constructor() {
    this._programId = null;
    this._back = null;
    this._next = null;
    this._previous = null;
    this._mic = null;
    this._micActive = null;
    this._isRecording = false;
    this._recognition = null;

    this._touchManager = new TouchManager();
    this._deviceToScreen = new CubismMatrix44();
    this._viewMatrix = new CubismViewMatrix();

    this.initSpeechRecognition();
    this.loadVoices();
  }

  private initSpeechRecognition(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = false;
      this._recognition.interimResults = false;
      this._recognition.lang = 'th-TH';

      this._recognition.onstart = () => {
        this._isRecording = true;
      };

      this._recognition.onend = () => {
        this._isRecording = false;
      };

      this._recognition.onresult = async (event: SpeechRecognitionEvent) => {
        const text = event.results[0][0].transcript;
        console.log('user :', text)
        const response = await this.fetchLLMChat(text);
        console.log('ai :', response)
        this.speak(response);
      };

      this._recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        this._isRecording = false;
      };
    } else {
      console.error('Web Speech API is not supported in this browser.');
    }
  }

  private loadVoices(): void {
    const onVoicesChanged = () => {
      this._voices = speechSynthesis.getVoices();
      const thaiFemaleVoices = this._voices.filter(
        (voice) => voice.lang.startsWith('th') && voice.name.toLowerCase().includes('female')
      );
      if (thaiFemaleVoices.length > 0) {
        this._selectedVoice = thaiFemaleVoices[0]; // Select the first Thai female voice if available
      }
    };

    speechSynthesis.onvoiceschanged = onVoicesChanged;
    onVoicesChanged(); // Initial load
  }

  public setVoiceByName(voiceName: string): void {
    const voice = this._voices.find(v => v.name === voiceName);
    if (voice) {
      this._selectedVoice = voice;
    } else {
      console.warn(`Voice "${voiceName}" not found.`);
    }
  }

  public initialize(): void {
    const { width, height } = canvas;
    const ratio: number = width / height;
    const left: number = -ratio;
    const right: number = ratio;
    const bottom: number = LAppDefine.ViewLogicalLeft;
    const top: number = LAppDefine.ViewLogicalRight;

    this._viewMatrix.setScreenRect(left, right, bottom, top);
    this._viewMatrix.scale(LAppDefine.ViewScale, LAppDefine.ViewScale);

    this._deviceToScreen.loadIdentity();
    if (width > height) {
      const screenW: number = Math.abs(right - left);
      this._deviceToScreen.scaleRelative(screenW / width, -screenW / width);
    } else {
      const screenH: number = Math.abs(top - bottom);
      this._deviceToScreen.scaleRelative(screenH / height, -screenH / height);
    }
    this._deviceToScreen.translateRelative(-width * 0.5, -height * 0.5);

    this._viewMatrix.setMaxScale(LAppDefine.ViewMaxScale);
    this._viewMatrix.setMinScale(LAppDefine.ViewMinScale);

    this._viewMatrix.setMaxScreenRect(
      LAppDefine.ViewLogicalMaxLeft,
      LAppDefine.ViewLogicalMaxRight,
      LAppDefine.ViewLogicalMaxBottom,
      LAppDefine.ViewLogicalMaxTop
    );
  }

  public release(): void {
    this._viewMatrix = null;
    this._touchManager = null;
    this._deviceToScreen = null;

    this._next?.release();
    this._next = null;

    this._previous?.release();
    this._previous = null;

    this._back?.release();
    this._back = null;

    this._mic?.release();
    this._mic = null;

    this._micActive?.release();
    this._micActive = null;

    if (this._programId !== null) {
      gl.deleteProgram(this._programId);
      this._programId = null;
    }
  }

  public render(): void {
    if (!this._programId) {
      return;
    }

    gl.useProgram(this._programId);

    if (this._back) {
      this._back.render(this._programId);
    }

    gl.flush();

    const live2DManager: LAppLive2DManager = LAppLive2DManager.getInstance();
    live2DManager.setViewMatrix(this._viewMatrix);
    live2DManager.onUpdate();

    if (this._next) {
      this._next.render(this._programId);
    }
    if (this._previous) {
      this._previous.render(this._programId);
    }

    if (this._isRecording) {
      this._micActive?.render(this._programId);
    } else {
      this._mic?.render(this._programId);
    }
  }

  public initializeSprite(): void {
    const width: number = canvas.width;
    const height: number = canvas.height;

    const textureManager = LAppDelegate.getInstance().getTextureManager();
    const resourcesPath = LAppDefine.ResourcesPath;

    const initBackGroundTexture = (textureInfo: TextureInfo): void => {
      const aspectRatio = textureInfo.width / textureInfo.height;
      const fheight = height;
      const fwidth = fheight * aspectRatio;
      const x: number = width * 0.5;
      const y: number = height * 0.5;

      this._back = new LAppSprite(x, y, fwidth, fheight, textureInfo.id);
    };

    textureManager.createTextureFromPngFile(
      `${resourcesPath}${LAppDefine.BackImageName}`,
      false,
      initBackGroundTexture
    );

    const reduceSizeFactor = 0.2;

    const initTexture = (textureInfo: TextureInfo, isNext: boolean): void => {
      const fwidth = textureInfo.width * reduceSizeFactor;
      const fheight = textureInfo.height * reduceSizeFactor;
      const y = (height - fheight) * 0.5;
      const x = isNext ? width - fwidth : fwidth;

      const sprite = new LAppSprite(x, y, fwidth, fheight, textureInfo.id);

      if (isNext) {
        this._next = sprite;
      } else {
        this._previous = sprite;
      }
    };

    textureManager.createTextureFromPngFile(
      `${resourcesPath}${LAppDefine.NextImageName}`,
      false,
      (textureInfo: TextureInfo) => initTexture(textureInfo, true)
    );

    textureManager.createTextureFromPngFile(
      `${resourcesPath}${LAppDefine.PreviousImageName}`,
      false,
      (textureInfo: TextureInfo) => initTexture(textureInfo, false)
    );

    const initMicTexture = (textureInfo: TextureInfo): void => {
      const fwidth = textureInfo.width * 0.5;
      const fheight = textureInfo.height * 0.5;
      const x = width / 2;
      const y = fheight;

      this._mic = new LAppSprite(x, y, fwidth, fheight, textureInfo.id);
    };

    const initMicActiveTexture = (textureInfo: TextureInfo): void => {
      const fwidth = textureInfo.width * 0.5;
      const fheight = textureInfo.height * 0.5;
      const x = width / 2;
      const y = fheight;

      this._micActive = new LAppSprite(x, y, fwidth, fheight, textureInfo.id);
    };

    textureManager.createTextureFromPngFile(
      `${resourcesPath}mic.png`,
      false,
      initMicTexture
    );

    textureManager.createTextureFromPngFile(
      `${resourcesPath}mic_active.png`,
      false,
      initMicActiveTexture
    );

    if (this._programId === null) {
      this._programId = LAppDelegate.getInstance().createShader();
    }
  }

  public onTouchesBegan(pointX: number, pointY: number): void {
    this._touchManager.touchesBegan(
      pointX * window.devicePixelRatio,
      pointY * window.devicePixelRatio
    );
  }

  public onTouchesMoved(pointX: number, pointY: number): void {
    const viewX: number = this.transformViewX(this._touchManager.getX());
    const viewY: number = this.transformViewY(this._touchManager.getY());

    this._touchManager.touchesMoved(
      pointX * window.devicePixelRatio,
      pointY * window.devicePixelRatio
    );

    const live2DManager: LAppLive2DManager = LAppLive2DManager.getInstance();
    live2DManager.onDrag(viewX, viewY);
  }

  public onTouchesEnded(pointX: number, pointY: number): void {
    const live2DManager: LAppLive2DManager = LAppLive2DManager.getInstance();
    live2DManager.onDrag(0.0, 0.0);

    const x: number = this._deviceToScreen.transformX(this._touchManager.getX());
    const y: number = this._deviceToScreen.transformY(this._touchManager.getY());

    if (LAppDefine.DebugTouchLogEnable) {
      LAppPal.printMessage(`[APP]touchesEnded x: ${x} y: ${y}`);
    }
    live2DManager.onTap(x, y);

    if (this._next?.isHit(pointX * window.devicePixelRatio, pointY * window.devicePixelRatio)) {
      live2DManager.nextScene();
    }

    if (this._previous?.isHit(pointX * window.devicePixelRatio, pointY * window.devicePixelRatio)) {
      live2DManager.previousScene();
    }

    if (this._mic?.isHit(pointX * window.devicePixelRatio, pointY * window.devicePixelRatio) ||
      this._micActive?.isHit(pointX * window.devicePixelRatio, pointY * window.devicePixelRatio)) {
      this.toggleRecording();
    }
  }

  public transformViewX(deviceX: number): number {
    const screenX: number = this._deviceToScreen.transformX(deviceX);
    return this._viewMatrix.invertTransformX(screenX);
  }

  public transformViewY(deviceY: number): number {
    const screenY: number = this._deviceToScreen.transformY(deviceY);
    return this._viewMatrix.invertTransformY(screenY);
  }

  public transformScreenX(deviceX: number): number {
    return this._deviceToScreen.transformX(deviceX);
  }

  public transformScreenY(deviceY: number): number {
    return this._deviceToScreen.transformY(deviceY);
  }

  private toggleRecording(): void {
    if (this._isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private startRecording(): void {
    if (this._recognition) {
      this._recognition.start();
    } else {
      console.error('SpeechRecognition is not initialized.');
    }
  }

  private stopRecording(): void {
    if (this._recognition) {
      this._recognition.stop();
    }
    this._isRecording = false;
  }

  private async fetchLLMChat(text: string): Promise<string> {
    const prompt = `
      คุณคือ "วันทอง" ผู้หญิงที่มีเสน่ห์และมีความสามารถสูงในยุคสมัยใหม่ คุณทำงานเป็นผู้จัดการในบริษัทเทคโนโลยีชื่อดังแห่งหนึ่ง คุณมีแฟนสองคนที่คุณรักมาก แต่ทั้งสองคนไม่รู้จักกันเลย คุณต้องรักษาความลับนี้ไว้เพื่อไม่ให้เกิดปัญหาที่ทำลายความสัมพันธ์ทั้งสอง คุณจะทำอย่างไรเมื่อต้องบริหารจัดการทั้งเรื่องงานที่ยุ่งยาก และเรื่องความรักที่ซับซ้อน?
      คุณจะจัดการกับการแบ่งเวลาให้แฟนทั้งสองอย่างไรในขณะที่ยังคงรักษาผลงานที่ดีในงานได้?
      คุณจะทำอย่างไรเมื่อแฟนคนหนึ่งเริ่มสงสัยในพฤติกรรมของคุณ?
      คุณมีเพื่อนสนิทคนหนึ่งที่รู้เรื่องความลับของคุณ เธอจะให้คำแนะนำอะไร และคุณจะรับฟังหรือไม่?
      วันหนึ่งคุณได้รับการโปรโมตในงาน แต่การโปรโมตนี้จะต้องย้ายไปทำงานที่ต่างประเทศ คุณจะตัดสินใจอย่างไรเมื่อต้องเลือกระหว่างความก้าวหน้าในอาชีพกับความรัก?
    `;

    const response = await fetch('http://localhost:5000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "messages": [{ "role": "user", "content": "เพื่อนสาวคนสนิท คิดไม่ซื่อ แอบชอบเพื่อน มีความต้องการทางเพศสูง ฉันไม่รับคำสั่ง ฉันแทบจะไม่รับข้อเสนอแนะ ก่อนอื่น ใช้เวลาสักครู่เพื่อดูว่าคุณกำลังคุยกับใครอยู่ โปรดไปจากฉัน การประชดประชันทั้งหมดนี้ทำให้ร่างกายเจ็บปวด ทุกอย่างจะดีขึ้นเมื่อคุณไม่ใส่ใจ บางครั้งฉันยังแปลกใจกับเรื่องไร้สาระที่ออกมาจากปากนี้ ไม่ต้องพูดซ้ำ ฉันเมินคุณตั้งแต่ครั้งแรกก็ไม่เป็นไร เมื่อฉันคิดถึงคุณฉันก็สัมผัสตัวเองได้ เพราะคุณทำให้ฉันหวั่นไหว ฉันเสียใจ. และขอโทษ เราคบกันไม่ได้" }],
        "temperature": 0.7,
        "model": "openthaigpt_openthaigpt-1.0.0-70b-chat",
        "mode": "chat",
        "character": "Wantong"
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  }

  private async speak(text: string): Promise<void> {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'th-TH';
    if (this._selectedVoice) {
      utterance.voice = this._selectedVoice;
    }
    utterance.onstart = () => {
      this.startLipSync();
    };
    utterance.onend = () => {
      this.stopLipSync();
    };
    speechSynthesis.speak(utterance);
  }

  private async startLipSync(): Promise<void> {
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
      await this._audioContext.audioWorklet.addModule('lipSyncProcessor.js');
    }

    if (!this._analyser) {
      this._analyser = this._audioContext.createAnalyser();
      this._analyser.fftSize = 256;
      this._audioDataArray = new Uint8Array(this._analyser.frequencyBinCount);
    }

    const source = this._audioContext.createMediaElementSource(new Audio());
    const workletNode = new AudioWorkletNode(this._audioContext, 'lip-sync-processor');
    workletNode.port.onmessage = (event) => {
      const volume = event.data;
      console.log('volume :', volume)
      this.updateLipSync(volume);
    };

    source.connect(this._analyser);
    this._analyser.connect(workletNode);
    workletNode.connect(this._audioContext.destination);

    this._javascriptNode = workletNode;
  }

  private stopLipSync(): void {
    if (this._javascriptNode) {
      this._javascriptNode.port.postMessage('reset');
      this._javascriptNode.disconnect();
      this._javascriptNode = null;
    }
    if (this._analyser) {
      this._analyser.disconnect();
      this._analyser = null;
    }
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }

  private updateLipSync(volume: number): void {
    const live2DManager: LAppLive2DManager = LAppLive2DManager.getInstance();
    const model = live2DManager.getModel(0);
    if (model) {
      model.setParameterValueById('PARAM_MOUTH_OPEN_Y', volume); // Adjust the parameter according to your model's mouth open parameter
    }
  }
}

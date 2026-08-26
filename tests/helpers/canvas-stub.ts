// tests/helpers/canvas-stub.ts
// happy-dom 无真实 canvas 2d 实现——组件测试统一 stub（单一真相，v2.5.3 抽取）。
// 此前 chart-detail-panel.test（mockCanvasContext）与 stock-table.test（stubCanvas2d）
// 各自维护 API 清单，绘制代码新增调用（setTransform/createLinearGradient/...）时
// 只补一处另一处就挂——技术债收敛于此。
// 用法：组件测试文件首行 import '../helpers/dom-environment.js'; 后调用一次。
import '../helpers/dom-environment.js';

/** 2d stub 形状（足够覆盖 sparkline 与详情大图的全部调用面）。 */
interface Canvas2DStub {
  clearRect(): void;
  fillRect(): void;
  strokeRect(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(): void;
  lineTo(): void;
  stroke(): void;
  fill(): void;
  fillText(): void;
  setLineDash(): void;
  setTransform(): void;
  measureText(): { width: number };
  createLinearGradient(): { addColorStop(): void };
}

/** 幂等安装（重复调用安全）。 */
export function stubCanvas2d(): void {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
    __chartStub?: Canvas2DStub;
  };
  if (proto.__chartStub) return;
  const stub: Canvas2DStub = {
    clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, fillText() {},
    setLineDash() {}, setTransform() {},
    measureText() { return { width: 10 }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  proto.__chartStub = stub;
  const original = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? stub : original.call(this, type);
  };
}

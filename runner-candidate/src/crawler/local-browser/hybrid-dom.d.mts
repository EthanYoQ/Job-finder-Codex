import type { BayerDomCapture } from '../bayerMokaRenderedTraversal';
import type { ServierDomCapture } from '../servierMokaRenderedTraversal';
import type { SanofiChineseDomCapture } from '../sanofiChineseRenderedTraversal';
export function captureLocalHybridDom(sourceId: string, signal?: AbortSignal): Promise<BayerDomCapture | ServierDomCapture | SanofiChineseDomCapture>;

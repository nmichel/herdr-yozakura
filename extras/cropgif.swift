// Crops an animated GIF to what its frames draw, at a given aspect ratio (0: none, the tight crop).
//   swiftc -O cropgif.swift -o cropgif
//   cropgif <in.gif> <out.gif> <aspect w/h> <padding px>
// The crop is the union of every frame's opaque pixels (so the animation doesn't jump), plus
// the padding, then widened (or heightened) around its center to the aspect; transparent
// pixels fill whatever lies outside the original canvas. Frame delays and looping are kept.
// A new dancer: `cropgif in.gif mods/yozakura-agents/dancers/<name>.gif 0 3`, then add
// [<name>, round(40 * width / height)] to DANCERS in yozakura-agents/main.js.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 5, let aspect = Double(args[3]), let pad = Int(args[4]) else {
  FileHandle.standardError.write("usage: cropgif <in.gif> <out.gif> <aspect> <padding>\n".data(using: .utf8)!)
  exit(2)
}
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
guard let source = CGImageSourceCreateWithURL(input as CFURL, nil) else { fatalError("can't read \(input.path)") }
let count = CGImageSourceGetCount(source)
let frames = (0..<count).map { CGImageSourceCreateImageAtIndex(source, $0, nil)! }
let W = frames[0].width, H = frames[0].height
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let info = CGImageAlphaInfo.premultipliedLast.rawValue

// The opaque pixels' bounds over every frame, top-down coordinates.
var minX = W, minY = H, maxX = -1, maxY = -1
for frame in frames {
  let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: space, bitmapInfo: info)!
  ctx.draw(frame, in: CGRect(x: 0, y: 0, width: W, height: H))
  let px = ctx.data!.bindMemory(to: UInt8.self, capacity: W * H * 4)
  for y in 0..<H {  // memory row 0 is the image's top row
    for x in 0..<W where px[(y * W + x) * 4 + 3] > 16 {
      minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    }
  }
}
// Padded, then grown to the aspect around its center.
var cx = Double(minX - pad), cy = Double(minY - pad)
var cw = Double(maxX - minX + 1 + 2 * pad), ch = Double(maxY - minY + 1 + 2 * pad)
if aspect > 0 { if cw / ch < aspect { let w = ch * aspect; cx -= (w - cw) / 2; cw = w } else { let h = cw / aspect; cy -= (h - ch) / 2; ch = h } }  // 0: no aspect, the tight crop
let ox = Int(cx.rounded()), oy = Int(cy.rounded()), ow = Int(cw.rounded()), oh = Int(ch.rounded())

// Frame properties as they were (delays), and the file's (looping).
let fileProps = CGImageSourceCopyProperties(source, nil) as? [CFString: Any] ?? [:]
guard let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.gif.identifier as CFString, count, nil) else { fatalError("can't write \(output.path)") }
let loop = (fileProps[kCGImagePropertyGIFDictionary] as? [CFString: Any])?[kCGImagePropertyGIFLoopCount] ?? 0
CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: loop]] as CFDictionary)
for (i, frame) in frames.enumerated() {
  let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: ow * 4, space: space, bitmapInfo: info)!
  // CG's origin is bottom left: the source's top-down row oy lands on the crop's top row.
  ctx.draw(frame, in: CGRect(x: -ox, y: oh - H + oy, width: W, height: H))
  let props = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any] ?? [:]
  let gif = props[kCGImagePropertyGIFDictionary] as? [CFString: Any] ?? [:]
  let delay = gif[kCGImagePropertyGIFUnclampedDelayTime] ?? gif[kCGImagePropertyGIFDelayTime] ?? 0.16
  CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay]] as CFDictionary)
}
guard CGImageDestinationFinalize(dest) else { fatalError("couldn't finish \(output.path)") }
print("\(input.lastPathComponent): \(W)x\(H) -> opaque \(minX),\(minY)-\(maxX),\(maxY) -> crop \(ox),\(oy) \(ow)x\(oh), \(count) frames")

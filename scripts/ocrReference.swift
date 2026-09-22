// ============================================================================
// 이 스크립트는 "편수자료" PDF(reference/ 폴더, git에는 커밋하지 않음)처럼
// 텍스트 레이어 없이 스캔된 이미지로만 이루어진 PDF에서 글자를 읽어내는 도구입니다.
// 원본 PDF는 pypdf/PDFKit 둘 다로 텍스트를 뽑아봐도 531페이지 중 딱 1페이지만
// 글자가 나오고 나머지는 전부 빈 값이었습니다 (스캔 이미지라 애초에 글자 정보가 없음).
// 그래서 "OCR(광학 문자 인식)"이 필요한데, 별도 프로그램을 설치하지 않아도
// macOS에 이미 내장된 Vision 프레임워크(VNRecognizeTextRequest)가 한국어 인식을
// 지원해서 이 스크립트에서 그대로 가져다 씁니다.
//
// 빌드 및 실행 방법:
//   swiftc -O scripts/ocrReference.swift -o /tmp/ocrReference
//   /tmp/ocrReference "<PDF 경로>" <시작페이지(0부터)> <끝페이지(포함, 0부터)> <출력 디렉토리>
//
// 페이지 하나당 약 0.6~0.7초 걸립니다(고해상도로 다시 그려서 인식하기 때문).
// 결과는 출력 디렉토리에 page-0001.txt 같은 이름으로 한 페이지당 한 파일씩 저장됩니다.
// ============================================================================

import PDFKit
import Vision
import CoreGraphics
import Foundation

let args = CommandLine.arguments
let path = args[1]
let start = Int(args[2])!
let end = Int(args[3])!
let outDir = args[4]

guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
    print("failed to open"); exit(1)
}

// 페이지 하나를 고해상도 이미지로 그린 뒤, Vision으로 그 이미지 속 글자를 읽어옵니다.
// scale을 3배로 키우는 이유: PDF 원본 해상도 그대로 인식시키면 작은 글자를 놓치기 쉬워서,
// 더 크게 확대해 그린 이미지를 넘겨야 OCR 정확도가 올라갑니다.
func ocrPage(_ page: PDFPage) -> String {
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 3.0
    let width = Int(bounds.width * scale)
    let height = Int(bounds.height * scale)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        return ""
    }
    // 배경을 흰색으로 미리 채워둡니다 (PDF 페이지에 투명 영역이 있으면 인식이 흐트러질 수 있음).
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    guard let cgImage = ctx.makeImage() else { return "" }

    // VNRecognizeTextRequest: macOS/iOS 기본 제공 OCR 엔진에게 "정확하게, 한국어 위주로 읽어줘"라고 요청
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["ko-KR", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return ""
    }
    guard let results = request.results else { return "" }
    // 한 줄(문단)마다 인식 후보가 여러 개 나올 수 있는데, 가장 확률 높은 후보(topCandidates(1))만 사용
    return results.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let startTime = Date()
for i in start...end {
    guard let page = doc.page(at: i) else { continue }
    let text = ocrPage(page)
    let outPath = "\(outDir)/page-\(String(format: "%04d", i + 1)).txt"
    try? text.write(toFile: outPath, atomically: true, encoding: .utf8)
}
let elapsed = Date().timeIntervalSince(startTime)
FileHandle.standardError.write("elapsed: \(elapsed)s for \(end - start + 1) pages\n".data(using: .utf8)!)

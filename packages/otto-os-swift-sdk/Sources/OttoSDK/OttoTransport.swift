import Foundation

public protocol OttoTransport: Sendable {
  func call<T: Decodable & Sendable>(
    groupSegments: [String],
    command: String,
    body: [String: OttoJSON],
    as type: T.Type
  ) async throws -> T

  func callBinary(
    groupSegments: [String],
    command: String,
    body: [String: OttoJSON]
  ) async throws -> OttoBinaryResponse
}

public struct OttoBinaryResponse: Sendable {
  public let data: Data
  public let contentType: String?
  public let statusCode: Int
  public let headers: [String: String]

  public init(data: Data, contentType: String?, statusCode: Int, headers: [String: String]) {
    self.data = data
    self.contentType = contentType
    self.statusCode = statusCode
    self.headers = headers
  }
}


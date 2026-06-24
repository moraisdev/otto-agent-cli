import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public final class HTTPTransport: OttoTransport, @unchecked Sendable {
  private let baseURL: URL
  private let contextKey: String
  private let session: URLSession
  private let timeout: TimeInterval
  private let extraHeaders: [String: String]

  public init(
    baseURL: URL,
    contextKey: String,
    session: URLSession = .shared,
    timeout: TimeInterval = 0,
    headers: [String: String] = [:]
  ) {
    self.baseURL = baseURL
    self.contextKey = contextKey
    self.session = session
    self.timeout = timeout
    self.extraHeaders = headers
  }

  public func call<T: Decodable & Sendable>(
    groupSegments: [String],
    command: String,
    body: [String: OttoJSON],
    as type: T.Type
  ) async throws -> T {
    let (data, response) = try await send(groupSegments: groupSegments, command: command, body: body, binary: false)
    guard (200..<300).contains(response.statusCode) else {
      throw buildOttoError(statusCode: response.statusCode, data: data)
    }
    if data.isEmpty, T.self == OttoJSON.self {
      return OttoJSON.object([:]) as! T
    }
    do {
      return try JSONDecoder().decode(type, from: data.isEmpty ? Data("{}".utf8) : data)
    } catch {
      throw OttoError.decoding(message: error.localizedDescription)
    }
  }

  public func callBinary(
    groupSegments: [String],
    command: String,
    body: [String: OttoJSON]
  ) async throws -> OttoBinaryResponse {
    let (data, response) = try await send(groupSegments: groupSegments, command: command, body: body, binary: true)
    guard (200..<300).contains(response.statusCode) else {
      throw buildOttoError(statusCode: response.statusCode, data: data)
    }
    return OttoBinaryResponse(
      data: data,
      contentType: response.value(forHTTPHeaderField: "content-type"),
      statusCode: response.statusCode,
      headers: response.allHeaderFields.reduce(into: [String: String]()) { acc, item in
        acc[String(describing: item.key)] = String(describing: item.value)
      }
    )
  }

  private func send(
    groupSegments: [String],
    command: String,
    body: [String: OttoJSON],
    binary: Bool
  ) async throws -> (Data, HTTPURLResponse) {
    let url = (["api", "v1"] + groupSegments + [command]).reduce(baseURL) { partial, component in
      partial.appendingPathComponent(component)
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    if timeout > 0 {
      request.timeoutInterval = timeout
    }
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue(binary ? "application/octet-stream, */*" : "application/json", forHTTPHeaderField: "accept")
    request.setValue("Bearer \(contextKey)", forHTTPHeaderField: "authorization")
    request.setValue(OTTO_SDK_VERSION, forHTTPHeaderField: "x-otto-sdk-version")
    request.setValue(OTTO_REGISTRY_HASH, forHTTPHeaderField: "x-otto-registry-hash")
    for (key, value) in extraHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }
    request.httpBody = try JSONEncoder().encode(OttoJSON.object(body))

    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw OttoError.transport(message: "Otto gateway returned a non-HTTP response")
      }
      return (data, http)
    } catch let error as OttoError {
      throw error
    } catch {
      throw OttoError.transport(message: error.localizedDescription)
    }
  }
}

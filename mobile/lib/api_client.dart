import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class _RecruitmentHttpClient extends http.BaseClient {
  final http.Client _inner = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final previewProfileId = RecruitmentApi.activePreviewProfileId;
    if (previewProfileId != null &&
        previewProfileId.isNotEmpty &&
        request.headers.containsKey('Authorization')) {
      request.headers['X-DropX-Preview-Profile'] = previewProfileId;
    }
    return _inner.send(request);
  }
}

class RecruitmentApi {
  RecruitmentApi({required this.baseUrl});
  final String baseUrl;
  static String? activePreviewProfileId;
  static final http.Client _client = _RecruitmentHttpClient();
  static final Map<String, Map<String, dynamic>> _optionsCache = {};

  Future<Map<String, dynamic>> authConfig() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/auth/config'),
      headers: {'Accept': 'application/json'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> requestOtp(String mobile) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/mobile/auth/request-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'mobile': mobile}),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> verifyOtp({
    required String challengeId,
    required String mobile,
    required String otp,
    String? deviceId,
    String? deviceName,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/mobile/auth/verify-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'challengeId': challengeId,
        'mobile': mobile,
        'otp': otp,
        'deviceId': deviceId,
        'deviceName': deviceName,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> bootstrap(String token) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/bootstrap'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> previewUsers(String token) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/preview-users'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> manualPunchRequests(
    String token, {
    bool approvalScope = false,
    String? status,
  }) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/manual-punch-requests')
        .replace(queryParameters: {
      if (approvalScope) 'scope': 'approval',
      if (status != null) 'status': status,
    });
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> requestManualPunch(
    String token, {
    required String punchType,
    required String reasonCode,
    required String reasonDetail,
    required String locationName,
    String? locationId,
    double? latitude,
    double? longitude,
    double? accuracy,
    bool? isMocked,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/manual-punch-requests'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'punchType': punchType,
        'reasonCode': reasonCode,
        'reasonDetail': reasonDetail,
        'locationName': locationName,
        'locationId': locationId,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'isMocked': isMocked,
        'clientRequestId':
            'manual-$punchType-${DateTime.now().microsecondsSinceEpoch}',
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> reviewManualPunch(
    String token, {
    required String id,
    required String action,
    String? remarks,
  }) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/recruitment/manual-punch-requests'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({'id': id, 'action': action, 'remarks': remarks}),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> googleLogin({
    required String idToken,
    String? deviceId,
    String? deviceName,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/google'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'idToken': idToken,
        'deviceId': deviceId,
        'deviceName': deviceName,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> dashboard(String token, {String? stream}) async {
    final query = Uri(queryParameters: {
      'mode': 'summary',
      if (stream != null) 'stream': stream,
    }).query;
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/dashboard?$query'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> workforcePlanning(
    String token, {
    String? date,
  }) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/capacity-demand').replace(
      queryParameters: {if (date != null) 'date': date},
    );
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> personalPerformance(
    String token, {
    String? from,
    String? to,
    String? month,
  }) async {
    final query = <String, String>{
      if (from != null) 'from': from,
      if (to != null) 'to': to,
      if (month != null) 'month': month,
    };
    final uri = Uri.parse('$baseUrl/api/recruitment/personal-performance')
        .replace(queryParameters: query);
    final response =
        await _client.get(uri, headers: {'Authorization': 'Bearer $token'});
    return _payload(response);
  }

  Future<Map<String, dynamic>> influencerPerformance(
    String token, {
    String? from,
    String? to,
  }) async {
    final query = <String, String>{
      'view': 'influencer',
      if (from != null) 'from': from,
      if (to != null) 'to': to,
    };
    final uri = Uri.parse('$baseUrl/api/recruitment/recruiter-performance')
        .replace(queryParameters: query);
    final response =
        await _client.get(uri, headers: {'Authorization': 'Bearer $token'});
    return _payload(response);
  }

  Future<Map<String, dynamic>> fieldDuty(
    String token, {
    String? date,
  }) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/field-duty').replace(
      queryParameters: {if (date != null) 'date': date},
    );
    final response =
        await _client.get(uri, headers: {'Authorization': 'Bearer $token'});
    return _payload(response);
  }

  Future<Map<String, dynamic>> fieldDutyAction(
    String token,
    Map<String, dynamic> body,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/field-duty'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode(body),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> fieldExpenses(String token) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/field-expenses'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> submitFieldExpense(
    String token,
    Map<String, dynamic> body,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/field-expenses'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode(body),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> fieldExecutives(
    String token, {
    String scope = 'mine',
    int page = 1,
    String? search,
    List<String> statuses = const [],
    List<String> stations = const [],
    List<String> designations = const [],
  }) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/field-executives').replace(
      queryParameters: {
        'scope': scope,
        'page': '$page',
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (statuses.isNotEmpty) 'status': statuses.join(','),
        if (stations.isNotEmpty) 'station': stations.join(','),
        if (designations.isNotEmpty) 'designation': designations.join(','),
      },
    );
    final response =
        await _client.get(uri, headers: {'Authorization': 'Bearer $token'});
    return _payload(response);
  }

  Future<Map<String, dynamic>> createFieldExecutive(
    String token, {
    required String fullName,
    required String mobile,
    required String email,
    required String joiningDate,
    required String locationCode,
    required String designation,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/field-executives'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'fullName': fullName,
        'mobile': mobile,
        'email': email,
        'joiningDate': joiningDate,
        'locationCode': locationCode,
        'designation': designation,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> reports(String token, {String? stream}) async {
    final query = stream == null ? '' : '?stream=$stream';
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/reports$query'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> activeAds(String token, {String? stream}) async {
    final query = stream == null ? '' : '?stream=$stream';
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/ads$query'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> module(String token, String name,
      {String? stream}) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/$name').replace(
      queryParameters: stream == null ? null : {'stream': stream},
    );
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> danapOnboarding(String token,
      {String scope = 'mine'}) async {
    final uri = Uri.parse('$baseUrl/api/recruitment/danap-onboarding')
        .replace(queryParameters: {'scope': scope});
    final response = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> options(String token) async {
    final cacheKey = '$baseUrl::$token';
    final cached = _optionsCache[cacheKey];
    if (cached != null) return cached;
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/options'),
      headers: {'Authorization': 'Bearer $token'},
    );
    final payload = _payload(response);
    _optionsCache[cacheKey] = payload;
    return payload;
  }

  Future<Map<String, dynamic>> metaAdBuilderCatalog(String token,
      {String? stream}) async {
    final query = stream == null ? '' : '?stream=$stream';
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/meta-ad-builder$query'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> uploadMetaAdImage(
    String token, {
    required String stream,
    required Uint8List bytes,
    required String fileName,
    required String contentType,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/recruitment/meta-ad-builder/media'),
    );
    request.headers['Authorization'] = 'Bearer $token';
    request.fields['stream'] = stream;
    request.files.add(http.MultipartFile.fromBytes(
      'file',
      bytes,
      filename: fileName,
      contentType: MediaType.parse(contentType),
    ));
    final streamed = await _client.send(request);
    return _payload(await http.Response.fromStream(streamed));
  }

  Future<Map<String, dynamic>> publishMetaAd(
    String token, {
    required String stream,
    required String locationId,
    required String roleId,
    required String clientRequestId,
    required Map<String, dynamic> draft,
    String launchMode = 'paused',
    bool confirmLive = false,
    bool validateOnly = false,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/meta-ad-builder'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'stream': stream,
        'locationId': locationId,
        'roleId': roleId,
        'clientRequestId': clientRequestId,
        'draft': draft,
        'launchMode': launchMode,
        'confirmLive': confirmLive,
        'validateOnly': validateOnly,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> createAdRequest(
    String token, {
    required String locationId,
    required String roleId,
    double? requestedBudget,
    int? daysRequired,
    String? posterUrl,
    String? paymentOffer,
    String? locationDetails,
    String? notes,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/ad-requests'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'requestType': 'new_ad',
        'locationId': locationId,
        'roleId': roleId,
        'requestedBudget': requestedBudget,
        'daysRequired': daysRequired,
        'posterUrl': posterUrl,
        'paymentOffer': paymentOffer,
        'locationDetails': locationDetails,
        'notes': notes,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> updateAdRequest(
    String token, {
    required String id,
    required String action,
    String? remarks,
    String? publishMode,
    Map<String, dynamic>? metaDraft,
    String? metaAdId,
    String? publishedUrl,
  }) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/recruitment/ad-requests'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'id': id,
        'action': action,
        'remarks': remarks,
        'publishMode': publishMode,
        'metaDraft': metaDraft,
        'metaAdId': metaAdId,
        'publishedUrl': publishedUrl,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> leads(
    String token, {
    int page = 1,
    String? stream,
    String? status,
    String? search,
    List<String> stations = const [],
    List<String> clusters = const [],
    List<String> roles = const [],
    String archive = 'active',
    bool unmapped = false,
    bool stale24 = false,
    bool facets = false,
    String? interviewFrom,
    String? interviewTo,
    String? menu,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'limit': '50',
      'archive': archive,
      if (stream != null) 'stream': stream,
      if (status != null) 'status': status,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      if (stations.isNotEmpty) 'station': stations.join(','),
      if (clusters.isNotEmpty) 'cluster': clusters.join(','),
      if (roles.isNotEmpty) 'role': roles.join(','),
      if (unmapped) 'unmapped': 'true',
      if (stale24) 'stale24': 'true',
      if (facets) 'facets': 'true',
      'compact': 'true',
      if (interviewFrom != null) 'interviewFrom': interviewFrom,
      if (interviewTo != null) 'interviewTo': interviewTo,
      if (menu != null) 'menu': menu,
    };
    final uri = Uri.parse('$baseUrl/api/recruitment/leads')
        .replace(queryParameters: query);
    final response =
        await _client.get(uri, headers: {'Authorization': 'Bearer $token'});
    return _payload(response);
  }

  Future<Map<String, dynamic>> updateStatus(
    String token, {
    required String leadId,
    required String status,
    String? remarks,
    String? callbackAt,
    String? interviewAt,
    bool retry = false,
    String menu = 'All Leads',
  }) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/recruitment/leads/$leadId/status'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'status': status,
        'remarks': remarks,
        'callbackAt': callbackAt,
        'interviewAt': interviewAt,
        'retry': retry,
        'menu': menu,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> leadDetail(
    String token,
    String leadId, {
    required String menu,
  }) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/recruitment/leads/$leadId')
          .replace(queryParameters: {'menu': menu}),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> updateLead(
    String token, {
    required String leadId,
    String? remarks,
    String? finalStatus,
    String? finalRemarks,
    String? workEmail,
    String menu = 'All Leads',
  }) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/recruitment/leads/$leadId'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'menu': menu,
        'remarks': remarks,
        'final_status': finalStatus,
        'final_remarks': finalRemarks,
        'work_email': workEmail,
      }),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> saveHrWorkflow(
    String token, {
    required String leadId,
    required Map<String, dynamic> values,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/leads/$leadId/hr-workflow'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode(values),
    );
    return _payload(response);
  }

  Future<Map<String, dynamic>> saveJoining(
    String token, {
    required String leadId,
    required String joiningDate,
    String? fullName,
    String? mobile,
    String? email,
    String? employeeId,
    String? providerEmployeeId,
    String? companyIdValue,
    String? paymentRecommendation,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/recruitment/leads/$leadId/joining'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode({
        'joiningDate': joiningDate,
        'fullName': fullName,
        'mobile': mobile,
        'email': email,
        'employeeId': employeeId,
        'providerEmployeeId': providerEmployeeId,
        'companyIdValue': companyIdValue,
        'paymentRecommendation': paymentRecommendation,
      }),
    );
    return _payload(response);
  }

  Map<String, dynamic> _payload(http.Response response) {
    Map<String, dynamic> payload;
    try {
      payload = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw Exception(
          'The server returned an invalid response (${response.statusCode}).');
    }
    if (response.statusCode >= 400) {
      throw Exception(payload['error'] ?? 'Request failed.');
    }
    return payload;
  }
}

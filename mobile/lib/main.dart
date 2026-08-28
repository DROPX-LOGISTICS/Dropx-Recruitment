import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api_client.dart';
import 'gps_point_queue.dart';

const apiBaseUrl = 'https://recruit.dropxlogistics.com';
const googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
const dropxPink = Color(0xffd82459);
const dropxInk = Color(0xff172033);
const dropxOrange = Color(0xffffa400);
const dropxCanvas = Color(0xfff4f6fb);
const dropxBorder = Color(0xffe4e7ec);
const dropxPurple = Color(0xff7f56d9);
const dropxGreen = Color(0xff12a56a);
const dropxBlue = Color(0xff2e6bd9);

Map<String, dynamic>? nearestAssignedLocation(
    List<dynamic> locations, double latitude, double longitude) {
  Map<String, dynamic>? nearest;
  var nearestMeters = double.infinity;
  for (final raw in locations) {
    if (raw is! Map<String, dynamic>) continue;
    final lat = double.tryParse('${raw['latitude'] ?? ''}');
    final lng = double.tryParse('${raw['longitude'] ?? ''}');
    if (lat == null || lng == null) continue;
    final meters = Geolocator.distanceBetween(latitude, longitude, lat, lng);
    if (meters < nearestMeters) {
      nearestMeters = meters;
      nearest = {...raw, 'distanceMeters': meters};
    }
  }
  return nearest;
}

const leadTransitions = <String, List<String>>{
  '': [
    'assigned',
    'contacting',
    'no_response',
    'call_back',
    'interested',
    'not_interested',
    'not_fit',
    'long_distance',
    'wrong_number',
    'unmapped',
    'invalid'
  ],
  'new': [
    'assigned',
    'contacting',
    'no_response',
    'call_back',
    'interested',
    'not_interested',
    'not_fit',
    'long_distance',
    'wrong_number'
  ],
  'assigned': [
    'contacting',
    'no_response',
    'call_back',
    'interested',
    'not_interested',
    'not_fit',
    'long_distance',
    'wrong_number'
  ],
  'contacting': [
    'no_response',
    'call_back',
    'interested',
    'not_interested',
    'not_fit',
    'long_distance',
    'wrong_number'
  ],
  'no_response': [
    'contacting',
    'call_back',
    'interested',
    'not_interested',
    'not_fit',
    'closed'
  ],
  'call_back': [
    'contacting',
    'no_response',
    'interested',
    'not_interested',
    'not_fit',
    'closed'
  ],
  'interested': ['interview_scheduled', 'hold', 'not_interested', 'not_fit'],
  'interview_scheduled': [
    'interview_rescheduled',
    'interview_no_show',
    'joined',
    'no_response',
    'call_back',
    'not_interested',
    'not_fit',
    'long_distance'
  ],
  'interview_rescheduled': [
    'interview_scheduled',
    'interview_no_show',
    'joined',
    'no_response',
    'call_back',
    'not_interested',
    'not_fit',
    'long_distance'
  ],
  'interview_completed': ['selected', 'hold', 'rejected'],
  'interview_no_show': ['interview_rescheduled', 'rejected', 'closed'],
  'hold': ['interview_scheduled', 'selected', 'rejected', 'closed'],
  'selected': ['documents_pending', 'offer_pending', 'rejected'],
  'documents_pending': ['offer_pending', 'rejected'],
  'offer_pending': ['offered', 'rejected'],
  'offered': ['joined', 'did_not_join'],
  'joined': ['archived'],
  'did_not_join': ['closed', 'archived'],
  'rejected': ['closed', 'archived'],
  'not_interested': ['closed', 'archived'],
  'not_fit': ['closed', 'archived'],
  'long_distance': ['closed', 'archived'],
  'wrong_number': ['closed', 'archived'],
  'unmapped': ['new', 'assigned', 'invalid'],
  'invalid': ['new', 'archived'],
  'closed': ['archived'],
  'document_issue': [
    'contacting',
    'call_back',
    'interested',
    'interview_scheduled',
    'closed'
  ],
};

const workforceQuickStatuses = <String>[
  'no_response',
  'not_interested',
  'call_back',
  'long_distance',
  'interview_scheduled',
  'not_fit',
  'document_issue',
];

String statusLabel(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty) return 'No Status';
  return normalized
      .split('_')
      .where((word) => word.isNotEmpty)
      .map((word) =>
          '${word.substring(0, 1).toUpperCase()}${word.substring(1).toLowerCase()}')
      .join(' ');
}

Map<String, dynamic> visibleQuestionnaire(Map<String, dynamic> questionnaire) {
  final merged = <String, dynamic>{};
  final raw = questionnaire['raw_extra'] ?? questionnaire['rawExtra'];
  if (raw is Map) {
    merged.addAll(Map<String, dynamic>.from(raw));
  } else if (raw is String && raw.trim().isNotEmpty) {
    try {
      final parsed = jsonDecode(raw);
      if (parsed is Map) merged.addAll(Map<String, dynamic>.from(parsed));
    } catch (_) {}
  }
  merged.addAll(questionnaire);
  const hidden = <String>{
    'id',
    'ad_id',
    'ad_name',
    'form_id',
    'form_name',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'full_name',
    'phone_number',
    'email',
    'created_time',
    'platform',
    'raw_extra',
    'sla_status',
    'updated_by',
    'reason_code',
    'source_sheet',
    'wa_new_sent_at',
    'meta_lead_id',
    'lead_id'
  };
  merged.removeWhere((key, value) {
    final normalized =
        key.trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
    if (hidden.contains(normalized) ||
        normalized.startsWith('meta_') ||
        normalized.startsWith('system_')) return true;
    if (value == null || value is Map || value is List) return true;
    if (value is String) {
      final text = value.trim().toLowerCase();
      if (text.isEmpty || text == 'null' || text == '—') return true;
    }
    return false;
  });
  return merged;
}

void main() {
  runApp(const DropXRecruitmentApp());
}

class DropXRecruitmentApp extends StatelessWidget {
  const DropXRecruitmentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'DropX Recruitment',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: dropxPink,
          primary: dropxPink,
          secondary: dropxOrange,
          tertiary: const Color(0xfff79009),
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: dropxCanvas,
        useMaterial3: true,
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: dropxInk,
          elevation: 0,
          scrolledUnderElevation: 1,
          surfaceTintColor: Colors.transparent,
          titleTextStyle: TextStyle(
              color: dropxInk, fontSize: 19, fontWeight: FontWeight.w800),
        ),
        cardTheme: CardTheme(
          color: Colors.white,
          elevation: 0,
          margin: const EdgeInsets.symmetric(vertical: 4),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: dropxBorder),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: dropxBorder),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: dropxBorder),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: dropxPink, width: 1.6),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(48, 48),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            textStyle: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Colors.white,
          indicatorColor: Color(0xffffe7ef),
          elevation: 3,
        ),
        chipTheme: ChipThemeData(
          backgroundColor: const Color(0xfff5f6f8),
          selectedColor: const Color(0xffffe7ef),
          side: const BorderSide(color: dropxBorder),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: dropxInk,
        ),
      ),
      home: const RecruitmentSessionGate(),
    );
  }
}

class RecruitmentSessionGate extends StatefulWidget {
  const RecruitmentSessionGate({super.key});

  @override
  State<RecruitmentSessionGate> createState() => _RecruitmentSessionGateState();
}

class _RecruitmentSessionGateState extends State<RecruitmentSessionGate> {
  final _storage = const FlutterSecureStorage();
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  late final Future<_RestoredSession?> _session = _restore();

  Future<_RestoredSession?> _restore() async {
    final token = await _storage.read(key: 'recruitment_session');
    if (token == null) return null;
    try {
      final payload = await _api.bootstrap(token);
      return _RestoredSession(token, payload['user'] as Map<String, dynamic>);
    } catch (_) {
      await _storage.delete(key: 'recruitment_session');
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_RestoredSession?>(
      future: _session,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
              body: Center(child: CircularProgressIndicator()));
        }
        final user = snapshot.data;
        return user == null
            ? const RecruitmentLoginPage()
            : RecruitmentHomePage(token: user.token, user: user.user);
      },
    );
  }
}

class RecruitmentLoginPage extends StatefulWidget {
  const RecruitmentLoginPage({super.key});

  @override
  State<RecruitmentLoginPage> createState() => _RecruitmentLoginPageState();
}

class _RecruitmentLoginPageState extends State<RecruitmentLoginPage> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _storage = const FlutterSecureStorage();
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  String? _challengeId;
  String? _error;
  String? _notice;
  bool _busy = false;

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final payload = await _api.requestOtp(_mobile.text);
      final challengeId = payload['challengeId'] as String?;
      setState(() {
        _challengeId = challengeId;
        if (challengeId == null) {
          _notice = payload['message']?.toString() ??
              'If this number is registered, the OTP will arrive on WhatsApp.';
        }
      });
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verifyOtp() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final payload = await _api.verifyOtp(
        challengeId: _challengeId!,
        mobile: _mobile.text,
        otp: _otp.text,
        deviceName: 'DropX Recruitment Mobile',
      );
      await _storage.write(
          key: 'recruitment_session', value: payload['token'] as String);
      final restored = await _api.bootstrap(payload['token'] as String);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => RecruitmentHomePage(
            token: payload['token'] as String,
            user: restored['user'] as Map<String, dynamic>),
      ));
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _googleLogin() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final config = await _api.authConfig();
      final runtimeClientId = config['googleClientId']?.toString().trim() ?? '';
      final serverClientId = googleServerClientId.isNotEmpty
          ? googleServerClientId
          : runtimeClientId;
      if (serverClientId.isEmpty) {
        throw Exception(
            'Google login is temporarily unavailable. Please use WhatsApp OTP.');
      }
      final account = await GoogleSignIn(
        serverClientId: serverClientId,
      ).signIn();
      if (account == null) return;
      final authentication = await account.authentication;
      final idToken = authentication.idToken;
      if (idToken == null) {
        throw Exception('Google did not return a valid identity token.');
      }
      final payload = await _api.googleLogin(
        idToken: idToken,
        deviceName: 'DropX Recruitment Mobile',
      );
      await _storage.write(
          key: 'recruitment_session', value: payload['token'] as String);
      final restored = await _api.bootstrap(payload['token'] as String);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => RecruitmentHomePage(
            token: payload['token'] as String,
            user: restored['user'] as Map<String, dynamic>),
      ));
    } on PlatformException catch (error) {
      final friendly = error.code == 'sign_in_failed' &&
              (error.message?.contains('10') ?? false)
          ? 'Google login setup needs an app certificate update. Please use WhatsApp OTP for now.'
          : 'Google sign-in could not be completed. Please try again.';
      setState(() => _error = friendly);
    } catch (error) {
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Image.asset('assets/dropx-logo.png',
                        height: 64, fit: BoxFit.contain),
                    const Text('RECRUITMENT',
                        textAlign: TextAlign.center,
                        style: TextStyle(letterSpacing: 2, color: Colors.grey)),
                    const SizedBox(height: 30),
                    TextField(
                      controller: _mobile,
                      enabled: _challengeId == null && !_busy,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        labelText: 'Registered mobile number',
                        prefixText: '+91 ',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    if (_challengeId != null) ...[
                      const SizedBox(height: 14),
                      TextField(
                        controller: _otp,
                        enabled: !_busy,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        decoration: const InputDecoration(
                          labelText: 'WhatsApp OTP',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(_error!,
                            style: const TextStyle(color: Colors.red)),
                      ),
                    if (_notice != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(_notice!,
                            style: const TextStyle(color: Color(0xff7a4b00))),
                      ),
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : (_challengeId == null ? _requestOtp : _verifyOtp),
                      child: Text(_busy
                          ? 'Please wait…'
                          : (_challengeId == null
                              ? 'Send WhatsApp OTP'
                              : 'Verify & Sign in')),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 14),
                      child: Row(children: [
                        Expanded(child: Divider()),
                        Padding(
                            padding: EdgeInsets.symmetric(horizontal: 10),
                            child: Text('or')),
                        Expanded(child: Divider()),
                      ]),
                    ),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _googleLogin,
                      icon: const Icon(Icons.login),
                      label: const Text('Continue with Google'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class RecruitmentHomePage extends StatefulWidget {
  const RecruitmentHomePage(
      {required this.token, required this.user, super.key});
  final String token;
  final Map<String, dynamic> user;

  @override
  State<RecruitmentHomePage> createState() => _RecruitmentHomePageState();
}

class _RecruitmentHomePageState extends State<RecruitmentHomePage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  late Map<String, dynamic> _user;
  late String _stream;
  List<dynamic> _previewUsers = const [];
  bool _switchBusy = false;
  String? _switchError;
  Future<Map<String, dynamic>>? _planning;

  @override
  void initState() {
    super.initState();
    _user = Map<String, dynamic>.from(widget.user);
    _stream = _user['workforce'] == true ? 'workforce' : 'hr';
    RecruitmentApi.activePreviewProfileId = null;
    if (_canViewWorkforcePlanFor(_user)) {
      _planning = _api.workforcePlanning(widget.token);
    }
    if (_user['canPreviewUsers'] == true) _loadPreviewUsers();
  }

  Future<void> _refreshHome() async {
    if (!_canViewWorkforcePlanFor(_user)) return;
    final next = _api.workforcePlanning(widget.token);
    setState(() => _planning = next);
    await next;
  }

  Future<void> _loadPreviewUsers() async {
    try {
      final payload = await _api.previewUsers(widget.token);
      if (mounted) {
        setState(() =>
            _previewUsers = payload['users'] as List<dynamic>? ?? const []);
      }
    } catch (error) {
      if (mounted) setState(() => _switchError = error.toString());
    }
  }

  Future<void> _switchUser(String? profileId) async {
    if (_switchBusy) return;
    setState(() {
      _switchBusy = true;
      _switchError = null;
    });
    RecruitmentApi.activePreviewProfileId = profileId;
    try {
      final payload = await _api.bootstrap(widget.token);
      final user = Map<String, dynamic>.from(payload['user'] as Map);
      if (!mounted) return;
      setState(() {
        _user = user;
        _stream = user['workforce'] == true ? 'workforce' : 'hr';
        _planning = _canViewWorkforcePlanFor(user)
            ? _api.workforcePlanning(widget.token)
            : null;
      });
    } catch (error) {
      RecruitmentApi.activePreviewProfileId =
          _user['previewProfileId']?.toString();
      if (mounted) setState(() => _switchError = error.toString());
    } finally {
      if (mounted) setState(() => _switchBusy = false);
    }
  }

  Future<void> _showUserSwitcher() async {
    if (_previewUsers.isEmpty) await _loadPreviewUsers();
    if (!mounted) return;
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (context) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .72,
        child: Column(children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Row(children: [
              Icon(Icons.manage_accounts_outlined),
              SizedBox(width: 10),
              Text('View app as user',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            ]),
          ),
          ListTile(
            leading: const CircleAvatar(
                child: Icon(Icons.admin_panel_settings_outlined)),
            title: const Text('My owner account'),
            subtitle: const Text('Exit read-only user preview'),
            onTap: () => Navigator.pop(context, '__owner__'),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              itemCount: _previewUsers.length,
              itemBuilder: (context, index) {
                final user = _previewUsers[index] as Map<String, dynamic>;
                return ListTile(
                  leading: CircleAvatar(
                      child: Text((user['name']?.toString() ?? 'U')
                          .substring(0, 1)
                          .toUpperCase())),
                  title: Text(user['name']?.toString() ?? 'Unnamed user'),
                  subtitle: Text([
                    user['designationCode'],
                    user['email'],
                  ]
                      .where((value) =>
                          value != null && value.toString().isNotEmpty)
                      .join(' • ')),
                  trailing: user['profileId'] == _user['previewProfileId']
                      ? const Icon(Icons.check_circle, color: dropxPink)
                      : null,
                  onTap: () =>
                      Navigator.pop(context, user['profileId'].toString()),
                );
              },
            ),
          ),
        ]),
      ),
    );
    if (selected == null) return;
    await _switchUser(selected == '__owner__' ? null : selected);
  }

  Future<void> _signOut() async {
    await _FieldDutyPageState.stopSharedTracking(flushPending: true);
    RecruitmentApi.activePreviewProfileId = null;
    await const FlutterSecureStorage().delete(key: 'recruitment_session');
    try {
      await GoogleSignIn().signOut();
    } catch (_) {}
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const RecruitmentLoginPage()),
      (_) => false,
    );
  }

  void _open(Widget page) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => page));
  }

  bool _mobileAllowed(String menuId) {
    return _mobileAllowedFor(_user, menuId);
  }

  bool _mobileAllowedFor(Map<String, dynamic> user, String menuId) {
    final function = user['recruitmentFunction']?.toString() ?? 'viewer';
    if (function == 'influencer') {
      return menuId == 'Field Executive Onboarding' ||
          menuId == 'Influencer Performance';
    }
    if (menuId == 'Recruiter Performance' && function == 'telecaller') {
      return true;
    }
    if (menuId == 'Field Recruitment' && function == 'field_recruiter') {
      return true;
    }
    if (!user.containsKey('mobileMenuPermissions')) return true;
    final values = user['mobileMenuPermissions'];
    return values is List &&
        values.map((item) => item.toString()).contains(menuId);
  }

  bool _canViewWorkforcePlanFor(Map<String, dynamic> user) {
    if (user['workforce'] != true) return false;
    return _mobileAllowedFor(user, 'Dashboard') ||
        _mobileAllowedFor(user, 'Workforce Plan');
  }

  List<Widget> _workspaceMenus() {
    final token = widget.token;
    if (_stream == 'hr') {
      return [
        if (_mobileAllowed('Dashboard'))
          _MenuCard(
            icon: Icons.space_dashboard_outlined,
            title: 'HR overview',
            subtitle: 'White-collar recruitment pipeline and pending work',
            onTap: () => _open(_DashboardPage(
                token: token, stream: 'hr', title: 'HR Overview')),
          ),
        if (_mobileAllowed('All Leads'))
          _MenuCard(
            icon: Icons.people_alt_outlined,
            title: 'Candidates',
            subtitle: 'Search and manage every HR candidate profile',
            onTap: () => _open(_LeadListPage(
                token: token, stream: 'hr', title: 'HR Candidates')),
          ),
        if (_mobileAllowed('Screening'))
          _MenuCard(
            icon: Icons.fact_check_outlined,
            title: 'Screening',
            subtitle: 'New, contacting and interested candidates',
            onTap: () => _open(_LeadListPage(
              token: token,
              stream: 'hr',
              title: 'Screening',
              status: 'new,assigned,contacting,interested',
            )),
          ),
        if (_mobileAllowed('Interviews'))
          _MenuCard(
            icon: Icons.event_available_outlined,
            title: 'Interviews',
            subtitle: 'Scheduled rounds, feedback and decisions',
            onTap: () => _open(_LeadListPage(
              token: token,
              stream: 'hr',
              title: 'HR Interviews',
              status:
                  'interview_scheduled,interview_rescheduled,interview_completed,interview_no_show',
            )),
          ),
        if (_mobileAllowed('Offers'))
          _MenuCard(
            icon: Icons.workspace_premium_outlined,
            title: 'Selection & offers',
            subtitle: 'Documents, offers, joining and final outcomes',
            onTap: () => _open(_LeadListPage(
              token: token,
              stream: 'hr',
              title: 'Selection & Offers',
              status:
                  'selected,documents_pending,offer_pending,offered,joined,did_not_join',
            )),
          ),
      ];
    }
    final function = _user['recruitmentFunction']?.toString() ?? 'viewer';
    if (function == 'influencer') {
      return [
        if (_mobileAllowed('Field Executive Onboarding'))
          _MenuCard(
            icon: Icons.person_add_alt_1_outlined,
            title: 'Refer an Associate',
            subtitle:
                'Start a verified candidate registration for an approved DA opening',
            onTap: () => _open(_FieldExecutiveOnboardingPage(
                token: token, influencerMode: true)),
          ),
        if (_mobileAllowed('Influencer Performance'))
          _MenuCard(
            icon: Icons.auto_graph_outlined,
            title: 'My Referrals & Milestones',
            subtitle:
                'Track registration, joining, verified active days and eligible value',
            onTap: () => _open(_InfluencerPerformancePage(token: token)),
          ),
      ];
    }
    if (function == 'field_recruiter') {
      return [
        if (_mobileAllowed('Field Recruitment'))
          _MenuCard(
            icon: Icons.route_outlined,
            title: 'Start My Field Mission',
            subtitle:
                'Track the live route, meet local candidates and build today’s hiring pipeline',
            onTap: () => _open(_FieldDutyPage(
              token: token,
              recruiterName: _user['name']?.toString() ?? 'Field recruiter',
              readOnly: _user['readOnly'] == true,
            )),
          ),
        if (_canViewWorkforcePlanFor(_user))
          _MenuCard(
            icon: Icons.donut_large_outlined,
            title: 'My Workforce Plan',
            subtitle:
                'Hiring gaps, current strength, training pipeline and volume for my assigned stations',
            onTap: () => _open(_WorkforcePlanningPage(token: token)),
          ),
        if (_mobileAllowed('Field Executive Onboarding'))
          _MenuCard(
            icon: Icons.badge_outlined,
            title: 'Field Executive Onboarding',
            subtitle: 'Create profiles and view associates initiated by you',
            onTap: () => _open(_FieldExecutiveOnboardingPage(token: token)),
          ),
        if (_mobileAllowed('DA In-app Onboarding'))
          _MenuCard(
            icon: Icons.rule_outlined,
            title: 'DA In-app Onboarding',
            subtitle: 'My pending Amazon onboarding dependencies',
            onTap: () => _open(_DanapMobilePage(token: token)),
          ),
        if (_mobileAllowed('Field Recruitment'))
          _MenuCard(
            icon: Icons.insights_outlined,
            title: 'Field Recruiter Performance',
            subtitle:
                'Daily and monthly conversion, joined associates, delivery and retention',
            onTap: () => _open(
                _PersonalPerformancePage(token: token, functionName: function)),
          ),
        if (_mobileAllowed('Field Recruitment'))
          _MenuCard(
            icon: Icons.receipt_long_outlined,
            title: 'Travel Reimbursement',
            subtitle:
                'Submit today’s travel proof before midnight and track approval or payment',
            onTap: () => _open(_TravelReimbursementPage(token: token)),
          ),
      ];
    }
    return [
      if (_mobileAllowed('Field Executive Onboarding'))
        _MenuCard(
          icon: Icons.badge_outlined,
          title: 'Field Executive Onboarding',
          subtitle: 'Create the operations profile and track your initiations',
          onTap: () => _open(_FieldExecutiveOnboardingPage(token: token)),
        ),
      if (_mobileAllowed('DA In-app Onboarding'))
        _MenuCard(
          icon: Icons.rule_outlined,
          title: 'DA In-app Onboarding',
          subtitle: function == 'manager'
              ? 'Team onboarding dependencies'
              : 'My onboarding dependencies',
          onTap: () => _open(_DanapMobilePage(token: token)),
        ),
      if (_mobileAllowed('Recruiter Performance'))
        _MenuCard(
          icon: Icons.insights_outlined,
          title: function == 'manager'
              ? 'Team Performance'
              : 'Telecaller Performance',
          subtitle: function == 'manager'
              ? 'Telecaller conversion, onboarding and retention'
              : 'Calls, outcomes, joining and monthly incentive',
          onTap: () => _open(
              _PersonalPerformancePage(token: token, functionName: function)),
        ),
      if (_mobileAllowed('Dashboard'))
        _MenuCard(
          icon: Icons.space_dashboard_outlined,
          title: 'Recruitment Command Center',
          subtitle: 'Source. Connect. Hire. Scale.',
          onTap: () => _open(_DashboardPage(
              token: token,
              stream: 'workforce',
              title: 'Recruitment Command Center')),
        ),
      if (_mobileAllowed('All Leads'))
        _MenuCard(
          icon: Icons.phone_in_talk_outlined,
          title: 'Calling queue',
          subtitle: 'Large phone numbers, quick call and status updates',
          onTap: () => _open(_LeadListPage(
              token: token, stream: 'workforce', title: 'Calling Queue')),
        ),
      if (_mobileAllowed('No Response / Call Back'))
        _MenuCard(
          icon: Icons.phone_missed_outlined,
          title: 'No response / Call back',
          subtitle: 'Retry candidates and manage follow-up times',
          onTap: () => _open(_LeadListPage(
            token: token,
            stream: 'workforce',
            title: 'No Response / Call Back',
            status: 'no_response,call_back',
          )),
        ),
      if (_mobileAllowed('Interviews'))
        _MenuCard(
          icon: Icons.event_outlined,
          title: 'Interviews',
          subtitle: 'Scheduled interviews and interview outcomes',
          onTap: () => _open(_LeadListPage(
            token: token,
            stream: 'workforce',
            title: 'Workforce Interviews',
            status:
                'interview_scheduled,interview_rescheduled,interview_completed,interview_no_show',
          )),
        ),
      if (_mobileAllowed('Interviews'))
        _MenuCard(
          icon: Icons.badge_outlined,
          title: 'Joining',
          subtitle: 'Selected, offered and joined associates',
          onTap: () => _open(_LeadListPage(
            token: token,
            stream: 'workforce',
            title: 'Joining',
            status: 'selected,documents_pending,offer_pending,offered,joined',
          )),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    final token = widget.token;
    final canSwitch = user['workforce'] == true && user['hr'] == true;
    final workspaceName = _stream == 'hr' ? 'HR' : 'Workforce';
    final functionName = user['recruitmentFunction']?.toString() ?? 'viewer';
    final isFieldRecruiter =
        _stream == 'workforce' && functionName == 'field_recruiter';
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          Image.asset('assets/dropx-logo.png', height: 34),
          const SizedBox(width: 10),
          const Text('Recruitment',
              style: TextStyle(fontWeight: FontWeight.w700)),
        ]),
        actions: [
          if (user['canPreviewUsers'] == true)
            IconButton(
              tooltip: 'View as user',
              onPressed: _switchBusy ? null : _showUserSwitcher,
              icon: _switchBusy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.switch_account_outlined),
            ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: _signOut,
            icon: const Icon(Icons.logout),
          )
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshHome,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
          children: [
            if (user['isPreview'] == true)
              Card(
                color: const Color(0xfffff5e6),
                child: ListTile(
                  leading: const Icon(Icons.visibility_outlined),
                  title: Text('Read-only preview: ${user['name'] ?? 'User'}'),
                  subtitle: const Text(
                      'You are seeing the same mobile access and data as this user.'),
                  trailing: TextButton(
                      onPressed: _switchBusy ? null : () => _switchUser(null),
                      child: const Text('Exit')),
                ),
              ),
            if (_switchError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_switchError!,
                    style: const TextStyle(color: Colors.red)),
              ),
            _HomeIdentityHero(
              name: user['name']?.toString() ?? 'Team',
              workspace: workspaceName,
              role: user['designationCode']?.toString() ??
                  user['accessTemplate']?.toString() ??
                  'Recruitment',
              functionName: user['recruitmentFunction']?.toString() ?? 'viewer',
            ),
            if (canSwitch) ...[
              const SizedBox(height: 16),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                      value: 'workforce',
                      label: Text('Workforce'),
                      icon: Icon(Icons.delivery_dining)),
                  ButtonSegment(
                      value: 'hr',
                      label: Text('HR'),
                      icon: Icon(Icons.business_center_outlined)),
                ],
                selected: {_stream},
                onSelectionChanged: (value) =>
                    setState(() => _stream = value.first),
              ),
            ],
            const SizedBox(height: 14),
            if (_stream == 'workforce' && _planning != null) ...[
              if (isFieldRecruiter) ...[
                _WorkspaceBanner(stream: _stream, functionName: functionName),
                const SizedBox(height: 14),
              ],
              FutureBuilder<Map<String, dynamic>>(
                future: _planning,
                builder: (context, snapshot) => _WorkforceHomeDashboard(
                  data: snapshot.data,
                  loading: !snapshot.hasData && !snapshot.hasError,
                  error: snapshot.hasError ? snapshot.error.toString() : null,
                  fieldRecruiter: isFieldRecruiter,
                  openPlanning: () =>
                      _open(_WorkforcePlanningPage(token: widget.token)),
                  openPrimary: isFieldRecruiter
                      ? () => _open(_FieldDutyPage(
                            token: widget.token,
                            recruiterName:
                                _user['name']?.toString() ?? 'Field recruiter',
                            readOnly: _user['readOnly'] == true,
                          ))
                      : () => _open(_LeadListPage(
                            token: widget.token,
                            stream: 'workforce',
                            title: 'Calling Queue',
                          )),
                  openOnboarding: () =>
                      _open(_FieldExecutiveOnboardingPage(token: widget.token)),
                ),
              ),
            ] else
              _WorkspaceBanner(stream: _stream, functionName: functionName),
            const SizedBox(height: 14),
            const _SectionLabel('Workspace'),
            ..._workspaceMenus(),
            const _SectionLabel('Shared tools'),
            if (_mobileAllowed('Archived Leads'))
              _MenuCard(
                icon: Icons.archive_outlined,
                title: 'Archived records',
                subtitle: 'Historical $workspaceName recruitment records',
                onTap: () => _open(_LeadListPage(
                  token: token,
                  stream: _stream,
                  title: '$workspaceName Archive',
                  archive: 'archived',
                )),
              ),
            if (_mobileAllowed('Reports'))
              _MenuCard(
                icon: Icons.analytics_outlined,
                title: 'Reports',
                subtitle: 'Pipeline, source, station and SLA performance',
                onTap: () => _open(_ReportsPage(token: token, stream: _stream)),
              ),
            if (user['canApproveManualPunch'] == true &&
                functionName != 'field_recruiter')
              _MenuCard(
                icon: Icons.approval_outlined,
                title: 'Manual Punch Approvals',
                subtitle:
                    'Approve field recruiter requests when biometric is unavailable',
                onTap: () => _open(_ManualPunchApprovalsPage(token: token)),
              ),
            if (user['manageMasters'] == true && _mobileAllowed('Unmapped'))
              _MenuCard(
                  icon: Icons.rule_folder_outlined,
                  title: 'Unmapped',
                  subtitle: 'Leads requiring station or designation mapping',
                  onTap: () => _open(_LeadListPage(
                      token: token,
                      stream: _stream,
                      title: 'Unmapped',
                      unmapped: true))),
            if (user['manageAds'] == true && _mobileAllowed('Active Ads'))
              _MenuCard(
                  icon: Icons.campaign_outlined,
                  title: 'Active Ads',
                  subtitle: 'Meta ads, spend and lead generation',
                  onTap: () => _open(_ActiveAdsPage(
                      token: token, stream: _stream, user: user))),
            if (_mobileAllowed('Ad Requests'))
              _MenuCard(
                  icon: Icons.add_task_outlined,
                  title: 'Ad Requests',
                  subtitle: ((user['adRequestActions'] as List<dynamic>? ?? [])
                          .contains('approve'))
                      ? 'Review, approve and track advertising requests'
                      : 'Create and track permitted advertising requests',
                  onTap: () => _open(_ModulePage(
                      token: token,
                      title: 'Ad Requests',
                      module: 'ad-requests',
                      stream: _stream))),
            if (user['manageMasters'] == true &&
                (_mobileAllowed('Station Directory') ||
                    _mobileAllowed('Station Contacts') ||
                    _mobileAllowed('Roles')))
              _MenuCard(
                  icon: Icons.hub_outlined,
                  title: 'Master',
                  subtitle: 'Locations, station contacts and designations',
                  onTap: () => _open(_ModulePage(
                      token: token, title: 'Master', module: 'masters'))),
            if (user['manageUsers'] == true && _mobileAllowed('Access Control'))
              _MenuCard(
                  icon: Icons.manage_accounts_outlined,
                  title: 'Team & Access',
                  subtitle: 'Approved identities and operational scope',
                  onTap: () => _open(_ModulePage(
                      token: token, title: 'Team & Access', module: 'access'))),
            if (user['manageUsers'] == true && _mobileAllowed('Connections'))
              _MenuCard(
                  icon: Icons.cable_outlined,
                  title: 'Connections',
                  subtitle:
                      'Meta, WhatsApp, Google and mobile connection state',
                  onTap: () => _open(_ModulePage(
                      token: token,
                      title: 'Connections',
                      module: 'connections'))),
            if (user['manageUsers'] == true && _mobileAllowed('System Health'))
              _MenuCard(
                  icon: Icons.monitor_heart_outlined,
                  title: 'System Health',
                  subtitle: 'Lead intake, source bridge and message queues',
                  onTap: () => _open(_ModulePage(
                      token: token,
                      title: 'System Health',
                      module: 'system-health'))),
            if (user['manageUsers'] == true && _mobileAllowed('Audit'))
              _MenuCard(
                  icon: Icons.history_outlined,
                  title: 'Audit',
                  subtitle: 'Latest lead and user activity',
                  onTap: () => _open(_ModulePage(
                      token: token, title: 'Audit', module: 'audit'))),
          ],
        ),
      ),
    );
  }
}

class _FieldDutyPage extends StatefulWidget {
  const _FieldDutyPage({
    required this.token,
    required this.recruiterName,
    required this.readOnly,
  });
  final String token;
  final String recruiterName;
  final bool readOnly;

  @override
  State<_FieldDutyPage> createState() => _FieldDutyPageState();
}

class _FieldDutyPageState extends State<_FieldDutyPage>
    with WidgetsBindingObserver {
  // Field tracking belongs to the active duty, not to this screen. Keeping the
  // native stream here as shared session state prevents a route from stopping
  // when the recruiter opens onboarding, performance, or another app screen.
  static StreamSubscription<Position>? _sharedLocationSubscription;
  static Timer? _sharedFlushTimer;
  static _FieldDutyPageState? _trackingOwner;
  static String? _trackingDutyId;

  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _expenseData;
  final List<Map<String, dynamic>> _pendingPoints = [];
  final List<Map<String, dynamic>> _routePoints = [];
  final Stopwatch _monotonicClock = Stopwatch()..start();
  int _nextPointSequence = 1;
  bool _flushing = false;
  GpsPointQueue? _pointQueue;
  String? _queuedDutyId;
  String? _lastSyncError;
  bool _queueWriteFailed = false;
  DateTime? _lastGpsAt;
  double? _lastGpsAccuracy;
  String _trackingState = 'Waiting for GPS';
  bool _busy = true;
  String? _error;

  Map<String, dynamic>? get _duty => _data?['duty'] as Map<String, dynamic>?;
  bool get _active => _duty?['status'] == 'active';
  bool get _completed => _duty?['status'] == 'completed';
  List<dynamic> get _contacts =>
      _duty?['contacts'] as List<dynamic>? ?? const [];
  List<dynamic> get _visits => _duty?['visits'] as List<dynamic>? ?? const [];
  List<dynamic> get _locations =>
      _data?['locations'] as List<dynamic>? ?? const [];
  List<dynamic> get _roles => _data?['roles'] as List<dynamic>? ?? const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Do not stop the duty-owned foreground location service when this route
    // is disposed. The shared owner continues persisting points until OUT and
    // day closure, or until the signed-in user explicitly signs out.
    super.dispose();
  }

  static Future<void> stopSharedTracking({
    bool flushPending = false,
    String? dutyId,
  }) async {
    if (dutyId != null && dutyId != _trackingDutyId) return;
    final owner = _trackingOwner;
    if (flushPending && owner != null) await owner._flushPoints();
    await _sharedLocationSubscription?.cancel();
    _sharedLocationSubscription = null;
    _sharedFlushTimer?.cancel();
    _sharedFlushTimer = null;
    _trackingOwner = null;
    _trackingDutyId = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _active) {
      unawaited(_flushPoints());
      unawaited(_startTracking());
    }
  }

  Future<Position?> _position() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw Exception('Turn on Location Services to continue.');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw Exception(permission == LocationPermission.deniedForever
          ? 'Location permission is permanently denied. Open Android Settings → Apps → DropX Recruitment → Permissions → Location and select Allow all the time.'
          : 'Precise location permission is required for field duty.');
    }
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        timeLimit: Duration(seconds: 12),
      ),
    );
  }

  Future<Position?> _stableStartPosition() async {
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    Position? best;
    var preciseSamples = 0;
    while (DateTime.now().isBefore(deadline)) {
      final sample = await _position();
      if (sample == null || sample.isMocked) return sample;
      if (best == null || sample.accuracy < best.accuracy) best = sample;
      if (sample.accuracy <= 25) preciseSamples += 1;
      if (preciseSamples >= 3) return best;
      await Future<void>.delayed(const Duration(milliseconds: 700));
    }
    return best;
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _api.fieldDuty(widget.token),
        _api.fieldExpenses(widget.token).catchError((_) => <String, dynamic>{}),
      ]);
      final payload = results[0] as Map<String, dynamic>;
      if (!mounted) return;
      final duty = payload['duty'] as Map<String, dynamic>?;
      if (duty != null) await _restoreQueuedPoints('${duty['id']}');
      final storedPoints = (duty?['points'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>();
      final combined = <String, Map<String, dynamic>>{};
      for (final point in [...storedPoints, ..._pendingPoints]) {
        combined['${point['recorded_at'] ?? point['recordedAt']}'] = point;
      }
      setState(() {
        _data = payload;
        _expenseData = results[1] as Map<String, dynamic>;
        _routePoints
          ..clear()
          ..addAll(combined.values);
        _nextPointSequence = _routePoints.fold<int>(1, (next, point) {
          final sequence = int.tryParse('${point['sequence'] ?? ''}') ?? 0;
          return math.max(next, sequence + 1);
        });
        final lastValue = duty?['last_gps_at']?.toString();
        _lastGpsAt = lastValue == null
            ? _lastGpsAt
            : DateTime.tryParse(lastValue)?.toLocal();
      });
      // Drain durable queues even when today's duty is already closed or no
      // duty is currently visible. This recovers an earlier offline route
      // before a later duty can begin.
      await _flushPoints();
      if (_active) await _startTracking();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<GpsPointQueue> _queue() async {
    final existing = _pointQueue;
    if (existing != null) return existing;
    final support = await getApplicationSupportDirectory();
    return _pointQueue =
        GpsPointQueue(Directory('${support.path}/field-duty-gps'));
  }

  Future<void> _restoreQueuedPoints(String dutyId) async {
    if (_queuedDutyId == dutyId) return;
    final restored = await (await _queue()).restore(dutyId);
    // In-memory points always belong to _queuedDutyId. Never merge points
    // from a completed duty into a new duty.
    _pendingPoints.clear();
    final byId = <String, Map<String, dynamic>>{};
    for (final point in restored) {
      byId['${point['clientPointId'] ?? point['recordedAt']}'] = point;
    }
    _pendingPoints
      ..clear()
      ..addAll(byId.values);
    _queuedDutyId = dutyId;
  }

  Map<String, dynamic> _point(Position position) => {
        'clientPointId':
            '${_duty?['id'] ?? 'pending'}-${position.timestamp.microsecondsSinceEpoch}-$_nextPointSequence',
        'dutyId': '${_duty?['id'] ?? ''}',
        'sequence': _nextPointSequence++,
        'monotonicMs': _monotonicClock.elapsedMilliseconds,
        'recordedAt': position.timestamp.toUtc().toIso8601String(),
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracy': position.accuracy,
        'speed': position.speed,
        'speedAccuracy': position.speedAccuracy,
        'altitude': position.altitude,
        'heading': position.heading,
        'headingAccuracy': position.headingAccuracy,
        'isMocked': position.isMocked,
        'provider': 'geolocator',
        'platform': defaultTargetPlatform.name,
        'appVersion': '1.4.1+131',
      };

  Future<void> _recordPosition(Position position,
      {bool flushNow = false}) async {
    final point = _point(position);
    final dutyId = '${_duty?['id'] ?? ''}';
    if (dutyId.isEmpty) return;
    try {
      await (await _queue()).append(dutyId, point);
      _pendingPoints.add(point);
      _lastSyncError = null;
    } catch (error) {
      _pendingPoints.add(point);
      _queueWriteFailed = true;
      _lastSyncError = 'Could not secure this GPS point on the phone: $error';
    }
    if (mounted) {
      setState(() {
        _lastGpsAt = position.timestamp.toLocal();
        _lastGpsAccuracy = position.accuracy;
        _trackingState = position.isMocked
            ? 'Mock location rejected'
            : position.accuracy > 25
                ? 'GPS settling • point not counted'
                : 'GPS tracking active';
      });
    }
    if (flushNow || _pendingPoints.length >= 2) await _flushPoints();
  }

  Future<void> _startTracking() async {
    final dutyId = '${_duty?['id'] ?? ''}';
    if (dutyId.isEmpty || !_active) return;
    if (_sharedLocationSubscription != null && _trackingDutyId == dutyId) {
      _trackingOwner = this;
      return;
    }
    if (_sharedLocationSubscription != null) {
      await stopSharedTracking(flushPending: true);
    }
    _trackingOwner = this;
    _trackingDutyId = dutyId;
    final initial = await _position();
    if (initial != null) await _recordPosition(initial, flushNow: true);
    late final LocationSettings settings;
    if (defaultTargetPlatform == TargetPlatform.android) {
      settings = AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 5,
        intervalDuration: const Duration(seconds: 10),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'DropX field duty is active',
          notificationText: 'Recording GPS route and live distance',
          notificationChannelName: 'Field duty location tracking',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      settings = AppleSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        activityType: ActivityType.automotiveNavigation,
        distanceFilter: 5,
        pauseLocationUpdatesAutomatically: false,
        showBackgroundLocationIndicator: true,
        allowBackgroundLocationUpdates: true,
      );
    } else {
      settings = const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation, distanceFilter: 5);
    }
    _sharedLocationSubscription =
        Geolocator.getPositionStream(locationSettings: settings).listen(
      (position) async {
        await _trackingOwner?._recordPosition(position);
      },
      onError: (Object error) {
        final owner = _trackingOwner;
        if (owner?.mounted == true) {
          owner!.setState(() {
            owner._trackingState = 'GPS tracking interrupted';
            owner._error = error.toString();
          });
        }
      },
    );
    _sharedFlushTimer?.cancel();
    _sharedFlushTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      final owner = _trackingOwner;
      if (owner != null) unawaited(owner._flushPoints());
    });
  }

  void _applyServerMetrics(
      Map<String, dynamic> response, Set<String> rejected) {
    final metrics = response['metrics'] as Map<String, dynamic>?;
    if (!mounted || metrics == null || _duty == null) return;
    setState(() {
      _duty!['distance_meters'] = metrics['distanceMeters'] ?? 0;
      _duty!['gps_point_count'] = metrics['validPointCount'] ?? 0;
      _duty!['gps_total_point_count'] = metrics['totalPointCount'] ?? 0;
      _duty!['gps_coverage_percent'] = metrics['coveragePercent'] ?? 0;
      _duty!['gps_confidence_percent'] = metrics['confidencePercent'] ?? 0;
      _duty!['gps_stationary_point_count'] =
          metrics['stationaryPointCount'] ?? 0;
      _duty!['stops'] = metrics['stops'] ?? const [];
      _duty!['stationary_duration_seconds'] =
          metrics['stationaryDurationSeconds'] ?? 0;
      _duty!['raw_distance_meters'] = metrics['rawDistanceMeters'] ?? 0;
      _duty!['last_gps_at'] = metrics['lastPointAt'];
      _routePoints
        ..clear()
        ..addAll((metrics['acceptedPoints'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>());
      _trackingState = 'Validated GPS synced';
      _lastSyncError = rejected.isEmpty
          ? null
          : '${rejected.length} invalid GPS point(s) were excluded.';
    });
  }

  Future<void> _flushPoints() async {
    if (_flushing) return;
    _flushing = true;
    var shouldRetry = false;
    try {
      final queue = await _queue();
      final currentDutyId = '${_duty?['id'] ?? ''}';
      final memoryDutyId =
          currentDutyId.isNotEmpty ? currentDutyId : (_queuedDutyId ?? '');
      final dutyIds = (await queue.pendingDutyIds()).toSet();
      if (memoryDutyId.isNotEmpty && _pendingPoints.isNotEmpty) {
        dutyIds.add(memoryDutyId);
      }

      // A queue is always uploaded with the duty ID encoded by its own file.
      // This prevents an offline route from yesterday entering today's duty.
      final orderedDutyIds = dutyIds.toList()
        ..sort((left, right) {
          if (left == currentDutyId) return -1;
          if (right == currentDutyId) return 1;
          return left.compareTo(right);
        });
      for (final dutyId in orderedDutyIds) {
        var batchNumber = 0;
        while (batchNumber < 10) {
          final byId = <String, Map<String, dynamic>>{
            for (final point in await queue.restore(dutyId))
              '${point['clientPointId'] ?? point['recordedAt']}': point,
          };
          if (dutyId == memoryDutyId) {
            for (final point in _pendingPoints) {
              byId['${point['clientPointId'] ?? point['recordedAt']}'] = point;
            }
          }
          final batch = byId.values.take(100).toList();
          if (batch.isEmpty) break;
          try {
            final response = await _api.fieldDutyAction(widget.token, {
              'action': 'points',
              'dutyId': dutyId,
              'points': batch,
            });
            final acknowledged =
                (response['acknowledgedPointIds'] as List<dynamic>? ?? const [])
                    .map((item) => '$item')
                    .where((item) => item.isNotEmpty)
                    .toSet();
            final rejected =
                (response['rejectedPointIds'] as List<dynamic>? ?? const [])
                    .map((item) => '$item')
                    .where((item) => item.isNotEmpty)
                    .toSet();
            final terminal = {...acknowledged, ...rejected};
            if (terminal.isEmpty) {
              throw Exception('The server did not acknowledge the GPS batch.');
            }
            await queue.acknowledge(dutyId, terminal);
            if (dutyId == memoryDutyId) {
              _pendingPoints.removeWhere((point) =>
                  terminal.contains('${point['clientPointId'] ?? ''}'));
              if (_pendingPoints.isEmpty) _queueWriteFailed = false;
            }
            if (dutyId == currentDutyId) {
              _applyServerMetrics(response, rejected);
            }
            batchNumber += 1;
          } catch (error) {
            shouldRetry = true;
            if (mounted && dutyId == currentDutyId) {
              setState(() {
                _trackingState = _queueWriteFailed
                    ? 'GPS captured • keep app open to sync'
                    : 'GPS saved on phone • waiting to sync';
                _lastSyncError =
                    error.toString().replaceFirst('Exception: ', '');
              });
            }
            break;
          }
        }
        if (batchNumber >= 10) shouldRetry = true;
      }
      shouldRetry = shouldRetry ||
          _pendingPoints.isNotEmpty ||
          (await queue.pendingDutyIds()).isNotEmpty;
    } catch (error) {
      shouldRetry = true;
      if (mounted) {
        setState(() {
          _trackingState = _queueWriteFailed
              ? 'GPS captured • keep app open to sync'
              : 'GPS saved on phone • waiting to sync';
          _lastSyncError = error.toString().replaceFirst('Exception: ', '');
        });
      }
    } finally {
      _flushing = false;
      if (shouldRetry && mounted) {
        Future<void>.delayed(const Duration(seconds: 15), () {
          if (mounted) unawaited(_flushPoints());
        });
      }
    }
  }

  Future<void> _startDuty() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _flushPoints();
      if (_pendingPoints.isNotEmpty || _queueWriteFailed) {
        throw Exception(
            'The previous GPS route is still waiting to sync. Keep the app open with internet and tap retry before starting a new duty.');
      }
      final current = await _stableStartPosition();
      final payload = await _api.fieldDutyAction(widget.token, {
        'action': 'start',
        'latitude': current?.latitude,
        'longitude': current?.longitude,
        'accuracy': current?.accuracy,
        'speed': current?.speed,
        'speedAccuracy': current?.speedAccuracy,
        'altitude': current?.altitude,
        'heading': current?.heading,
        'headingAccuracy': current?.headingAccuracy,
        'isMocked': current?.isMocked,
        'sequence': _nextPointSequence++,
        'monotonicMs': _monotonicClock.elapsedMilliseconds,
        'provider': 'geolocator',
        'platform': defaultTargetPlatform.name,
        'appVersion': '1.4.1+131',
        'recordedAt': current?.timestamp.toUtc().toIso8601String(),
        'punchInAt': _data?['attendance']?['punchInAt'],
      });
      final duty = payload['duty'] as Map<String, dynamic>?;
      setState(() {
        _data = {...?_data, 'duty': duty};
        _routePoints
          ..clear()
          ..addAll((duty?['points'] as List<dynamic>? ?? const [])
              .whereType<Map<String, dynamic>>());
      });
      if (duty?['id'] != null) await _restoreQueuedPoints('${duty!['id']}');
      await _startTracking();
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _requestManualPunch({String punchType = 'in'}) async {
    List<dynamic> reasons = const [];
    try {
      final payload = await _api.manualPunchRequests(widget.token);
      reasons = payload['reasons'] as List<dynamic>? ?? const [];
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
      return;
    }
    if (!mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (_) => _ManualPunchRequestForm(
        token: widget.token,
        punchType: punchType,
        reasons: reasons,
        locations: _locations,
        duty: _duty,
        currentPosition: _position,
      ),
    );
    if (saved == true) await _load();
  }

  Future<void> _addPerson() async {
    await _flushPoints();
    if (!mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FieldContactForm(
        token: widget.token,
        dutyId: _duty!['id'].toString(),
        duty: _duty!,
        roles: _roles,
        currentPosition: _position,
      ),
    );
    if (saved == true) await _load();
  }

  Future<void> _endDuty() async {
    await _load();
    final attendance = _data?['attendance'] as Map<String, dynamic>?;
    if (attendance?['punchOutVerified'] != true) {
      final request = attendance?['manualOutRequest'] as Map<String, dynamic>?;
      if (request?['status'] == 'pending') {
        if (mounted) {
          setState(() => _error =
              'Manual OUT is waiting for approval. Duty and GPS tracking remain active.');
        }
        return;
      }
      await _requestManualPunch(punchType: 'out');
      return;
    }
    try {
      final current = await _position();
      if (current != null) await _recordPosition(current, flushNow: true);
    } catch (_) {
      // The end-duty form still reports a clear GPS error if location is off.
    }
    await _flushPoints();
    if (!mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _EndFieldDutyForm(
        token: widget.token,
        dutyId: _duty!['id'].toString(),
        duty: _duty!,
        expenseData: _expenseData ?? const {},
        locations: _locations,
        hasContacts: _contacts.isNotEmpty,
        currentPosition: _position,
      ),
    );
    if (saved == true) {
      await stopSharedTracking(
        flushPending: true,
        dutyId: '${_duty?['id'] ?? ''}',
      );
      await _load();
    }
  }

  String _summary() {
    final duty = _duty ?? {};
    final interested = _contacts.where((item) {
      final outcome = (item as Map<String, dynamic>)['outcome'];
      return outcome == 'interested' ||
          outcome == 'follow_up' ||
          outcome == 'interview_scheduled';
    }).length;
    final hotspots = _visits
        .whereType<Map<String, dynamic>>()
        .where((item) => '${item['visit_type'] ?? ''}'.startsWith('hotspot_'))
        .map((item) => item['location_name']?.toString())
        .whereType<String>()
        .toSet();
    final km = (num.tryParse('${duty['distance_meters'] ?? 0}') ?? 0) / 1000;
    return '''FIELD RECRUITER DAILY REPORT

${widget.recruiterName}
Date: ${duty['duty_date'] ?? _data?['date'] ?? ''}
Major hotspots: ${hotspots.isEmpty ? '—' : hotspots.join(', ')}
Field distance: ${km.toStringAsFixed(1)} km

FIELD ACTIVITY
People contacted: ${_contacts.length}
Qualified leads: $interested
Interviews scheduled: ${_contacts.where((item) => (item as Map<String, dynamic>)['outcome'] == 'interview_scheduled').length}

PLAN FOR TOMORROW
Target contacts: ${duty['tomorrow_target'] ?? '—'}
Expected joinees: ${duty['expected_joinees'] ?? '—'}

Challenges / Support Required:
${duty['challenges'] ?? '—'}

Plan:
${duty['tomorrow_plan'] ?? '—'}

Remarks:
${duty['remarks'] ?? '—'}''';
  }

  @override
  Widget build(BuildContext context) {
    final attendance = _data?['attendance'] as Map<String, dynamic>?;
    final manualRequest = attendance?['manualRequest'] as Map<String, dynamic>?;
    final manualOutRequest =
        attendance?['manualOutRequest'] as Map<String, dynamic>?;
    final attendanceText = attendance?['source'] == 'biometric'
        ? 'Biometric punch-in verified'
        : attendance?['source'] == 'manual_approved'
            ? 'Manual punch approved${manualRequest?['reviewerName'] == null ? '' : ' by ${manualRequest?['reviewerName']}'}${manualRequest?['review_remarks'] == null ? '' : ': ${manualRequest?['review_remarks']}'}'
            : manualRequest?['status'] == 'pending'
                ? 'Manual punch request pending approval'
                : manualRequest?['status'] == 'rejected'
                    ? 'Manual punch request rejected: ${manualRequest?['review_remarks'] ?? manualRequest?['reviewRemarks'] ?? 'See reviewer remarks'}'
                    : 'Waiting for biometric punch-in';
    return Scaffold(
      appBar: AppBar(title: const Text('My Field Duty')),
      body: _busy && _data == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error != null)
                    Card(
                      color: const Color(0xfffff1f3),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(_error!,
                            style: const TextStyle(color: Colors.red)),
                      ),
                    ),
                  if (widget.readOnly)
                    const Card(
                      color: Color(0xfffff5e6),
                      child: ListTile(
                        leading: Icon(Icons.visibility_outlined),
                        title: Text('Owner preview is read-only'),
                        subtitle: Text(
                            'Exit View as user to approve requests or make changes.'),
                      ),
                    ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _completed
                                ? 'Duty completed'
                                : _active
                                    ? 'Field duty active'
                                    : 'Ready to start',
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            attendanceText,
                            style: const TextStyle(color: Color(0xff667085)),
                          ),
                          if (_active) ...[
                            const SizedBox(height: 5),
                            Text(
                              attendance?['punchOutVerified'] == true
                                  ? 'OUT verified • ${attendance?['punchOutSource'] == 'biometric' ? 'Biometric' : 'Approved manual OUT'}'
                                  : manualOutRequest?['status'] == 'pending'
                                      ? 'Manual OUT pending • tracking continues'
                                      : manualOutRequest?['status'] ==
                                              'rejected'
                                          ? 'Manual OUT rejected • biometric OUT or a new request is required'
                                          : 'OUT not yet verified • duty cannot close',
                              style: TextStyle(
                                color: attendance?['punchOutVerified'] == true
                                    ? dropxGreen
                                    : dropxOrange,
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                              ),
                            ),
                          ],
                          if (manualRequest != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              '${manualRequest['locationName'] ?? ''}${manualRequest['reason'] == null ? '' : ' • ${manualRequest['reason']}'}',
                              style: const TextStyle(
                                  fontSize: 12, color: Color(0xff667085)),
                            ),
                          ],
                          if (!_active && !_completed) ...[
                            const SizedBox(height: 16),
                            Row(children: [
                              Expanded(
                                child: FilledButton.icon(
                                  onPressed: widget.readOnly ||
                                          _busy ||
                                          attendance?['verified'] != true
                                      ? null
                                      : _startDuty,
                                  icon: const Icon(Icons.play_arrow),
                                  label: const Text('Start Field Duty'),
                                ),
                              ),
                            ]),
                            if (attendance?['verified'] != true &&
                                manualRequest?['status'] != 'pending') ...[
                              const SizedBox(height: 8),
                              SizedBox(
                                width: double.infinity,
                                child: OutlinedButton.icon(
                                  onPressed: widget.readOnly || _busy
                                      ? null
                                      : _requestManualPunch,
                                  icon: const Icon(Icons.fingerprint_outlined),
                                  label: Text(
                                      manualRequest?['status'] == 'rejected'
                                          ? 'Request Again'
                                          : 'Request Manual Punch'),
                                ),
                              ),
                            ],
                          ],
                        ],
                      ),
                    ),
                  ),
                  if (_duty != null) ...[
                    Card(
                      color: const Color(0xfff4f3ff),
                      child: ListTile(
                        leading: const Icon(Icons.location_on_outlined,
                            color: Color(0xff6941c6)),
                        title: Text(
                          '${_duty!['primary_location_code'] ?? ''}${_duty!['primary_location_code'] == null ? '' : ' — '}${_duty!['primary_location_name'] ?? 'Approved duty location'}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          'Today’s work station • locked from ${_duty!['primary_location_source'] == 'biometric_device' ? 'biometric device' : 'approved manual IN'}',
                        ),
                      ),
                    ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _DutyMetric(
                                value: '${_contacts.length}', label: 'People'),
                            _DutyMetric(
                              value:
                                  '${_contacts.where((item) => (item as Map<String, dynamic>)['outcome'] != 'not_interested' && item['outcome'] != 'not_eligible').length}',
                              label: 'Leads',
                            ),
                            _DutyMetric(
                              value:
                                  '${((num.tryParse('${_duty!['distance_meters'] ?? 0}') ?? 0) / 1000).toStringAsFixed(1)} km',
                              label: 'Validated',
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Card(
                      color: _trackingState.contains('active') ||
                              _trackingState.contains('synced')
                          ? const Color(0xffecfdf3)
                          : const Color(0xfffff8eb),
                      child: ListTile(
                        leading: Icon(
                          _trackingState.contains('active') ||
                                  _trackingState.contains('synced')
                              ? Icons.gps_fixed
                              : Icons.gps_not_fixed,
                          color: _trackingState.contains('active') ||
                                  _trackingState.contains('synced')
                              ? dropxGreen
                              : dropxOrange,
                        ),
                        title: Text(_trackingState,
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Text(
                          '${_duty!['gps_point_count'] ?? 0}/${_duty!['gps_total_point_count'] ?? _routePoints.length} precise points'
                          ' • ${_duty!['gps_confidence_percent'] ?? 0}% confidence'
                          '${_lastGpsAt == null ? '' : ' • Last ${TimeOfDay.fromDateTime(_lastGpsAt!).format(context)}'}'
                          '${_lastGpsAccuracy == null ? '' : ' • ±${_lastGpsAccuracy!.round()} m'}'
                          '${_pendingPoints.isEmpty ? '' : ' • ${_pendingPoints.length} queued'}',
                        ),
                        trailing: _pendingPoints.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Retry GPS sync now',
                                onPressed: _flushing ? null : _flushPoints,
                                icon: const Icon(Icons.sync),
                              ),
                      ),
                    ),
                    if (_lastSyncError != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          'Last sync issue: $_lastSyncError. Pending GPS will retry automatically.',
                          style: const TextStyle(color: Color(0xffb54708)),
                        ),
                      ),
                    _FieldDutyRouteMap(
                        points: _routePoints, contacts: _contacts),
                    if ((_duty!['stops'] as List<dynamic>? ?? const [])
                        .isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Card(
                        child: ExpansionTile(
                          leading: const Icon(Icons.pause_circle_outline,
                              color: dropxOrange),
                          title: const Text('Stops detected',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                          subtitle: Text(
                              '${(_duty!['stops'] as List<dynamic>).length} stop(s) of 5 minutes or more'),
                          children: (_duty!['stops'] as List<dynamic>)
                              .whereType<Map<String, dynamic>>()
                              .map((stop) {
                            final latitude = stop['latitude'];
                            final longitude = stop['longitude'];
                            final started =
                                DateTime.tryParse('${stop['startedAt'] ?? ''}')
                                    ?.toLocal();
                            final ended =
                                DateTime.tryParse('${stop['endedAt'] ?? ''}')
                                    ?.toLocal();
                            return ListTile(
                              dense: true,
                              leading: const Icon(Icons.schedule_outlined),
                              title: Text(
                                  '${stop['durationMinutes'] ?? 0} minutes stopped'),
                              subtitle: Text(
                                '${started == null ? '—' : TimeOfDay.fromDateTime(started).format(context)} – '
                                '${ended == null ? '—' : TimeOfDay.fromDateTime(ended).format(context)}'
                                '${latitude == null || longitude == null ? '' : '\n$latitude, $longitude'}',
                              ),
                              isThreeLine:
                                  latitude != null && longitude != null,
                              trailing: latitude == null || longitude == null
                                  ? null
                                  : IconButton(
                                      tooltip: 'Open exact stop in Google Maps',
                                      icon: const Icon(Icons.map_outlined),
                                      onPressed: () => launchUrl(
                                        Uri.parse(
                                            'https://www.google.com/maps?q=$latitude,$longitude'),
                                        mode: LaunchMode.externalApplication,
                                      ),
                                    ),
                            );
                          }).toList(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Card(
                      child: ExpansionTile(
                        leading: const Icon(Icons.receipt_long_outlined,
                            color: dropxPink),
                        title: const Text('Travel Reimbursement',
                            style: TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Text(
                            '${(_expenseData?['expenses'] as List<dynamic>? ?? const []).length} claim(s) • Main Dashboard approval status'),
                        children: [
                          if ((_expenseData?['expenses'] as List<dynamic>? ??
                                  const [])
                              .isEmpty)
                            const Padding(
                              padding: EdgeInsets.all(16),
                              child: Text(
                                  'No claims yet. Add travel expense before closing duty.'),
                            )
                          else
                            ...(_expenseData?['expenses'] as List<dynamic>? ??
                                    const [])
                                .take(5)
                                .map((raw) {
                              final item = raw as Map<String, dynamic>;
                              final payment =
                                  item['payment'] as Map<String, dynamic>? ??
                                      const {};
                              return ListTile(
                                dense: true,
                                title: Text(
                                    '${item['field_travel_expense_types']?['name'] ?? 'Travel'} • ₹${payment['amount_requested'] ?? payment['amount'] ?? 0}'),
                                subtitle: Text(
                                    '${item['stations']?['station_code'] ?? '—'} • ${statusLabel(item['status']?.toString() ?? '')}'),
                                trailing: payment['utr_cin'] == null
                                    ? null
                                    : Text('UTR ${payment['utr_cin']}'),
                              );
                            }),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (_active)
                      Row(children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: widget.readOnly ? null : _addPerson,
                            icon: const Icon(Icons.person_add_alt_1),
                            label: const Text('Add Person'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: widget.readOnly ? null : _endDuty,
                            icon: const Icon(Icons.stop_circle_outlined),
                            label: Text(attendance?['punchOutVerified'] == true
                                ? 'Close Duty'
                                : manualOutRequest?['status'] == 'pending'
                                    ? 'OUT Pending'
                                    : 'Verify OUT'),
                          ),
                        ),
                      ]),
                    if (_completed)
                      Card(
                        color: const Color(0xfffff7fa),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              const Text(
                                'DAILY SUMMARY',
                                style: TextStyle(
                                  color: dropxPink,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 1.2,
                                ),
                              ),
                              const SizedBox(height: 10),
                              SelectableText(
                                _summary(),
                                style: const TextStyle(height: 1.45),
                              ),
                              const SizedBox(height: 14),
                              FilledButton.icon(
                                onPressed: () => Share.share(
                                  _summary(),
                                  subject: 'Field recruiter daily report',
                                ),
                                icon: const Icon(Icons.share),
                                label: const Text('Share Daily Summary'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: 12),
                    Text('People contacted',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    if (_contacts.isEmpty)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(18),
                          child: Text('No people added yet.'),
                        ),
                      ),
                    ..._contacts.map((raw) {
                      final item = raw as Map<String, dynamic>;
                      final contactLatitude = item['latitude'];
                      final contactLongitude = item['longitude'];
                      return Card(
                        child: ListTile(
                          leading: const CircleAvatar(
                              child: Icon(Icons.person_outline)),
                          title: Text(item['full_name']?.toString() ?? '—'),
                          subtitle: Text(
                            '${item['recruitment_roles']?['code'] ?? 'Role not selected'} • '
                            '${item['recruitment_locations']?['code'] ?? 'Location not selected'}\n'
                            '${statusLabel(item['outcome']?.toString() ?? '')}'
                            '${contactLatitude == null || contactLongitude == null ? '' : '\nGPS tagged • $contactLatitude, $contactLongitude'}',
                          ),
                          isThreeLine: true,
                          trailing: contactLatitude == null ||
                                  contactLongitude == null
                              ? Text(item['phone']?.toString() ?? '')
                              : IconButton(
                                  tooltip: 'Open contact point in Google Maps',
                                  icon: const Icon(Icons.location_on_outlined),
                                  onPressed: () => launchUrl(
                                    Uri.parse(
                                        'https://www.google.com/maps?q=$contactLatitude,$contactLongitude'),
                                    mode: LaunchMode.externalApplication,
                                  ),
                                ),
                        ),
                      );
                    }),
                  ],
                ],
              ),
            ),
    );
  }
}

class _ManualPunchRequestForm extends StatefulWidget {
  const _ManualPunchRequestForm({
    required this.token,
    required this.punchType,
    required this.reasons,
    required this.locations,
    required this.duty,
    required this.currentPosition,
  });
  final String token;
  final String punchType;
  final List<dynamic> reasons;
  final List<dynamic> locations;
  final Map<String, dynamic>? duty;
  final Future<Position?> Function() currentPosition;

  @override
  State<_ManualPunchRequestForm> createState() =>
      _ManualPunchRequestFormState();
}

class _ManualPunchRequestFormState extends State<_ManualPunchRequestForm> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  final _reason = TextEditingController();
  final _newLocation = TextEditingController();
  String? _locationId;
  String? _reasonCode;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final available = widget.reasons.whereType<Map<String, dynamic>>().where(
        (item) =>
            item['punch_type'] == 'both' ||
            item['punch_type'] == widget.punchType);
    _reasonCode =
        available.isEmpty ? null : available.first['code']?.toString();
    if (widget.punchType == 'out') {
      _locationId = widget.duty?['primary_location_id']?.toString();
    } else {
      unawaited(_selectNearest());
    }
  }

  Future<void> _selectNearest() async {
    try {
      final position = await widget.currentPosition();
      if (position == null || !mounted) return;
      final nearest = nearestAssignedLocation(
          widget.locations, position.latitude, position.longitude);
      if (nearest != null) {
        setState(() => _locationId = nearest['id']?.toString());
      }
    } catch (_) {
      // The user can still select an assigned or new location manually.
    }
  }

  @override
  void dispose() {
    _reason.dispose();
    _newLocation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final lockedLocationId = widget.duty == null
        ? null
        : widget.duty!['primary_location_id']?.toString();
    final selected = widget.locations.cast<Map<String, dynamic>?>().firstWhere(
          (item) => item?['id']?.toString() == _locationId,
          orElse: () => null,
        );
    final locationName = widget.punchType == 'out'
        ? '${widget.duty?['primary_location_code'] ?? ''}${widget.duty?['primary_location_code'] == null ? '' : ' — '}${widget.duty?['primary_location_name'] ?? 'Locked duty location'}'
        : _locationId == '__new__'
            ? _newLocation.text.trim()
            : [selected?['code'], selected?['name']]
                .where((value) => value != null && value.toString().isNotEmpty)
                .join(' — ');
    if (locationName.length < 2 || _reasonCode == null) {
      setState(() => _error = 'Select the duty location and a reason.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final position = await widget.currentPosition();
      await _api.requestManualPunch(
        widget.token,
        punchType: widget.punchType,
        reasonCode: _reasonCode!,
        reasonDetail: _reason.text.trim(),
        locationName: locationName,
        locationId: widget.punchType == 'out'
            ? lockedLocationId
            : _locationId == '__new__'
                ? null
                : _locationId,
        latitude: position?.latitude,
        longitude: position?.longitude,
        accuracy: position?.accuracy,
        isMocked: position?.isMocked,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.viewInsetsOf(context).bottom + 24),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Request Manual ${widget.punchType.toUpperCase()}',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(
              widget.punchType == 'out'
                  ? 'Use this when biometric OUT is unavailable. Duty and GPS tracking stay active until this is approved.'
                  : 'Use this when biometric IN is unavailable. Current GPS, time and accuracy are attached for approval.',
              style: const TextStyle(color: Color(0xff667085)),
            ),
            const SizedBox(height: 18),
            if (widget.punchType == 'out')
              Card(
                color: const Color(0xfff4f3ff),
                child: ListTile(
                  leading: const Icon(Icons.location_on_outlined,
                      color: Color(0xff6941c6)),
                  title: Text(
                      '${widget.duty?['primary_location_code'] ?? ''}${widget.duty?['primary_location_code'] == null ? '' : ' — '}${widget.duty?['primary_location_name'] ?? 'Locked duty location'}'),
                  subtitle: const Text(
                      'Manual OUT is permanently linked to the station used for IN.'),
                ),
              )
            else
              DropdownButtonFormField<String>(
                value: _locationId,
                decoration: const InputDecoration(labelText: 'Duty location'),
                items: [
                  ...widget.locations.map((item) {
                    final row = item as Map<String, dynamic>;
                    return DropdownMenuItem(
                      value: row['id']?.toString(),
                      child:
                          Text('${row['code'] ?? ''} — ${row['name'] ?? ''}'),
                    );
                  }),
                  const DropdownMenuItem(
                      value: '__new__', child: Text('New / unlisted location')),
                ],
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _locationId = value),
              ),
            if (widget.punchType != 'out' &&
                _locationId != null &&
                _locationId != '__new__')
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('Nearest assigned location selected from GPS.',
                    style: TextStyle(color: dropxGreen, fontSize: 11)),
              ),
            if (widget.punchType != 'out' && _locationId == '__new__') ...[
              const SizedBox(height: 12),
              TextField(
                controller: _newLocation,
                decoration:
                    const InputDecoration(labelText: 'New location name'),
              ),
            ],
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _reasonCode,
              decoration: const InputDecoration(labelText: 'Reason'),
              items: widget.reasons
                  .whereType<Map<String, dynamic>>()
                  .where((item) =>
                      item['punch_type'] == 'both' ||
                      item['punch_type'] == widget.punchType)
                  .map((item) => DropdownMenuItem(
                        value: item['code']?.toString(),
                        child: Text(item['name']?.toString() ?? 'Reason'),
                      ))
                  .toList(),
              onChanged:
                  _busy ? null : (value) => setState(() => _reasonCode = value),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reason,
              minLines: 3,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: 'Additional details (optional)',
                hintText: 'Add a short note for the approving manager',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _busy ? null : _submit,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send_outlined),
              label:
                  Text('Send ${widget.punchType.toUpperCase()} for Approval'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ManualPunchApprovalsPage extends StatefulWidget {
  const _ManualPunchApprovalsPage({required this.token});
  final String token;

  @override
  State<_ManualPunchApprovalsPage> createState() =>
      _ManualPunchApprovalsPageState();
}

class _ManualPunchApprovalsPageState extends State<_ManualPunchApprovalsPage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  List<dynamic> _requests = const [];
  bool _busy = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = await _api.manualPunchRequests(
        widget.token,
        approvalScope: true,
        status: 'pending',
      );
      if (mounted) {
        setState(() =>
            _requests = payload['requests'] as List<dynamic>? ?? const []);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review(Map<String, dynamic> request, String action) async {
    final remarks = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(action == 'approve'
            ? 'Approve manual punch?'
            : 'Reject manual punch?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${request['recruiterName']} • ${request['locationName']}'),
            const SizedBox(height: 8),
            Text(request['reason']?.toString() ?? ''),
            const SizedBox(height: 14),
            TextField(
              controller: remarks,
              minLines: 2,
              maxLines: 4,
              decoration: InputDecoration(
                labelText: action == 'reject'
                    ? 'Rejection reason (required)'
                    : 'Approval remarks (optional)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (action == 'reject' && remarks.text.trim().length < 3) return;
              Navigator.pop(context, true);
            },
            child: Text(action == 'approve' ? 'Approve' : 'Reject'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      remarks.dispose();
      return;
    }
    setState(() => _busy = true);
    try {
      await _api.reviewManualPunch(
        widget.token,
        id: request['id'].toString(),
        action: action,
        remarks: remarks.text.trim(),
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      remarks.dispose();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Manual Punch Approvals')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null)
              Card(
                color: const Color(0xfffff1f3),
                child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_error!,
                        style: const TextStyle(color: Colors.red))),
              ),
            if (_busy && _requests.isEmpty)
              const Padding(
                  padding: EdgeInsets.all(48),
                  child: Center(child: CircularProgressIndicator()))
            else if (_requests.isEmpty)
              const Padding(
                padding: EdgeInsets.all(48),
                child: Center(
                    child: Text(
                        'No manual punch requests are waiting for approval.')),
              )
            else
              ..._requests.map((item) {
                final request = item as Map<String, dynamic>;
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            request['recruiterName']?.toString() ??
                                'Field recruiter',
                            style: const TextStyle(
                                fontSize: 17, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        Text(
                            '${request['punchType']?.toString().toUpperCase() ?? 'IN'} • ${request['date']} • ${request['requestedTime']} • ${request['locationName']}'),
                        const SizedBox(height: 8),
                        Text(request['reason']?.toString() ?? ''),
                        const SizedBox(height: 4),
                        Text('GPS: ${request['gps'] ?? 'Unavailable'}',
                            style: const TextStyle(
                                fontSize: 12, color: Color(0xff667085))),
                        const SizedBox(height: 14),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () => _review(request, 'reject'),
                              child: const Text('Reject'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton(
                              onPressed: _busy
                                  ? null
                                  : () => _review(request, 'approve'),
                              child: const Text('Approve'),
                            ),
                          ),
                        ]),
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

class _FieldDutyRouteMap extends StatelessWidget {
  const _FieldDutyRouteMap({required this.points, required this.contacts});
  final List<Map<String, dynamic>> points;
  final List<dynamic> contacts;

  DateTime? _time(Map<String, dynamic> point) =>
      DateTime.tryParse('${point['recorded_at'] ?? point['recordedAt'] ?? ''}');

  double? _number(dynamic value) {
    final parsed = double.tryParse('$value');
    return parsed?.isFinite == true ? parsed : null;
  }

  bool _quality(Map<String, dynamic> point) {
    final latitude = _number(point['latitude']);
    final longitude = _number(point['longitude']);
    // The live API uses camelCase normalized route points. Restored/offline
    // points can still use database or device keys, so accept every format.
    final accuracy = _number(point['accuracyMeters'] ??
        point['accuracy_meters'] ??
        point['accuracy']);
    final mocked = point['is_mocked'] == true || point['isMocked'] == true;
    return latitude != null &&
        longitude != null &&
        accuracy != null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        !(latitude == 0 && longitude == 0) &&
        accuracy <= 25 &&
        !mocked &&
        _time(point) != null;
  }

  @override
  Widget build(BuildContext context) {
    final valid = points.where(_quality).toList()
      ..sort((a, b) => _time(a)!.compareTo(_time(b)!));
    if (valid.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Row(children: [
            Icon(Icons.map_outlined, color: dropxOrange),
            SizedBox(width: 10),
            Expanded(
                child: Text(
                    'Route map will appear after the first valid GPS signal.')),
          ]),
        ),
      );
    }
    const distance = Distance();
    final segments = <List<LatLng>>[[]];
    for (var index = 0; index < valid.length; index += 1) {
      final current = LatLng(_number(valid[index]['latitude'])!,
          _number(valid[index]['longitude'])!);
      if (index > 0) {
        final previous = LatLng(_number(valid[index - 1]['latitude'])!,
            _number(valid[index - 1]['longitude'])!);
        final seconds = _time(valid[index])!
            .difference(_time(valid[index - 1])!)
            .inSeconds
            .abs();
        final gapMeters = distance.as(LengthUnit.Meter, previous, current);
        final continuityBroken = seconds > 15 * 60 ||
            gapMeters > 5000 ||
            (seconds > 5 * 60 && gapMeters > 1500);
        if (continuityBroken) {
          segments.add([]);
        }
      }
      segments.last.add(current);
    }
    final route = segments.expand((segment) => segment).toList();
    final contactMarkers = contacts
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final latitude = _number(item['latitude']);
          final longitude = _number(item['longitude']);
          if (latitude == null || longitude == null) return null;
          return Marker(
            point: LatLng(latitude, longitude),
            width: 36,
            height: 36,
            child: Tooltip(
              message:
                  '${item['full_name'] ?? 'Contact'} • ${statusLabel('${item['outcome'] ?? ''}')}',
              child: const Icon(Icons.person_pin_circle,
                  color: dropxBlue, size: 32),
            ),
          );
        })
        .whereType<Marker>()
        .toList();
    final markers = <Marker>[
      Marker(
        point: route.first,
        width: 34,
        height: 34,
        child: const Tooltip(
          message: 'Duty started',
          child: Icon(Icons.trip_origin, color: dropxGreen, size: 28),
        ),
      ),
      Marker(
        point: route.last,
        width: 34,
        height: 34,
        child: const Tooltip(
          message: 'Latest GPS point',
          child: Icon(Icons.location_on, color: dropxPink, size: 32),
        ),
      ),
      ...contactMarkers,
    ];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(14, 13, 14, 9),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Live travel trace',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            SizedBox(height: 3),
            Text(
                'Exact GPS breadcrumbs • Green start • Pink latest • Blue contacts',
                style: TextStyle(color: Color(0xff667085), fontSize: 11)),
          ]),
        ),
        SizedBox(
          height: 280,
          child: FlutterMap(
            options: MapOptions(
              initialCenter: route.first,
              initialZoom: route.length == 1 ? 16 : 13,
              initialCameraFit: route.length > 1
                  ? CameraFit.bounds(
                      bounds: LatLngBounds.fromPoints(route),
                      padding: const EdgeInsets.all(34))
                  : null,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.dropxlogistics.dropx_recruitment',
              ),
              PolylineLayer(
                polylines: segments
                    .where((segment) => segment.length > 1)
                    .map((segment) => Polyline(
                        points: segment, color: dropxPink, strokeWidth: 5))
                    .toList(),
              ),
              MarkerLayer(markers: markers),
              const RichAttributionWidget(attributions: [
                TextSourceAttribution('OpenStreetMap contributors'),
              ]),
            ],
          ),
        ),
      ]),
    );
  }
}

class _DutyMetric extends StatelessWidget {
  const _DutyMetric({required this.value, required this.label});
  final String value;
  final String label;
  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value,
            style: const TextStyle(
                fontWeight: FontWeight.w800, fontSize: 20, color: dropxInk)),
        Text(label, style: const TextStyle(color: Color(0xff667085))),
      ]);
}

class _FieldContactForm extends StatefulWidget {
  const _FieldContactForm({
    required this.token,
    required this.dutyId,
    required this.duty,
    required this.roles,
    required this.currentPosition,
  });
  final String token;
  final String dutyId;
  final Map<String, dynamic> duty;
  final List<dynamic> roles;
  final Future<Position?> Function() currentPosition;
  @override
  State<_FieldContactForm> createState() => _FieldContactFormState();
}

class _FieldContactFormState extends State<_FieldContactForm> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _notes = TextEditingController();
  String? _roleId;
  String _outcome = 'follow_up';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_roleId == null) {
      setState(() => _error = 'Select the role discussed.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final position = await widget.currentPosition();
      await RecruitmentApi(baseUrl: apiBaseUrl).fieldDutyAction(widget.token, {
        'action': 'contact',
        'dutyId': widget.dutyId,
        'fullName': _name.text,
        'phone': _phone.text,
        'roleId': _roleId,
        'outcome': _outcome,
        'notes': _notes.text,
        'latitude': position?.latitude,
        'longitude': position?.longitude,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 14,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 20),
      child: SingleChildScrollView(
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Add person contacted',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text(
              'Capture the person and clear next outcome. GPS records where the conversation happened.',
              style: TextStyle(color: Color(0xff667085))),
          const SizedBox(height: 14),
          TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Person’s name')),
          const SizedBox(height: 10),
          TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              decoration: const InputDecoration(labelText: 'Contact number')),
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: const Color(0xffecfdf3),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xffabefc6)),
            ),
            child: Row(children: [
              const Icon(Icons.location_on_outlined,
                  color: dropxGreen, size: 20),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(
                      '${widget.duty['primary_location_code'] ?? ''}${widget.duty['primary_location_code'] == null ? '' : ' — '}${widget.duty['primary_location_name'] ?? 'Approved duty location'} • work station locked from IN punch; contact GPS is recorded separately',
                      style: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w700))),
            ]),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _roleId,
            decoration: const InputDecoration(labelText: 'Role discussed'),
            items: widget.roles
                .map((raw) => raw as Map<String, dynamic>)
                .map((item) => DropdownMenuItem(
                      value: item['id'].toString(),
                      child: Text('${item['code']} — ${item['name']}'),
                    ))
                .toList(),
            onChanged: (value) => setState(() => _roleId = value),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _outcome,
            decoration: const InputDecoration(labelText: 'Outcome'),
            items: const [
              DropdownMenuItem(value: 'interested', child: Text('Interested')),
              DropdownMenuItem(
                  value: 'follow_up', child: Text('Follow-up required')),
              DropdownMenuItem(
                  value: 'interview_scheduled',
                  child: Text('Interview scheduled')),
              DropdownMenuItem(
                  value: 'not_interested', child: Text('Not interested')),
            ],
            onChanged: (value) =>
                setState(() => _outcome = value ?? 'follow_up'),
          ),
          const SizedBox(height: 10),
          TextField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Notes (optional)')),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 14),
          FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? 'Saving…' : 'Save Person')),
        ]),
      ),
    );
  }
}

class _TravelReimbursementPage extends StatefulWidget {
  const _TravelReimbursementPage({required this.token});
  final String token;

  @override
  State<_TravelReimbursementPage> createState() =>
      _TravelReimbursementPageState();
}

class _TravelReimbursementPageState extends State<_TravelReimbursementPage> {
  late Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() =>
      RecruitmentApi(baseUrl: apiBaseUrl).fieldExpenses(widget.token);

  Future<void> _refresh() async {
    final next = _load();
    setState(() => _future = next);
    await next;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Travel Reimbursement')),
        body: FutureBuilder<Map<String, dynamic>>(
          future: _future,
          builder: (context, snapshot) {
            if (!snapshot.hasData && !snapshot.hasError) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.cloud_off_outlined,
                        size: 42, color: Colors.red),
                    const SizedBox(height: 12),
                    Text(snapshot.error.toString(),
                        textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton.tonal(
                        onPressed: _refresh, child: const Text('Try again')),
                  ]),
                ),
              );
            }
            final data = snapshot.data ?? const <String, dynamic>{};
            final accounts = data['bankAccounts'] as List<dynamic>? ?? const [];
            final expenses = data['expenses'] as List<dynamic>? ?? const [];
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [
                        Color(0xff172033),
                        Color(0xff5d315d),
                        Color(0xffd7195b)
                      ]),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('TODAY’S TRAVEL',
                              style: TextStyle(
                                  color: Color(0xffffc4d5),
                                  fontSize: 10,
                                  letterSpacing: 1.2,
                                  fontWeight: FontWeight.w900)),
                          SizedBox(height: 5),
                          Text('Claim before the day closes',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 21,
                                  fontWeight: FontWeight.w900)),
                          SizedBox(height: 5),
                          Text(
                              'Close field duty with verified OUT, attach the receipt, and submit the same day. Previous-day claims are locked.',
                              style: TextStyle(
                                  color: Color(0xfff2e9f0), fontSize: 12)),
                        ]),
                  ),
                  const SizedBox(height: 14),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.account_balance_outlined,
                          color: dropxGreen),
                      title: Text(accounts.isEmpty
                          ? 'No verified payout account'
                          : '${accounts.length} verified payout account${accounts.length == 1 ? '' : 's'}'),
                      subtitle: Text(accounts.isEmpty
                          ? (data['bankAction']?.toString() ??
                              'Add and verify an account in DropX One.')
                          : 'Only masked account details are shown here.'),
                      trailing: const Icon(Icons.open_in_new),
                      onTap: () => launchUrl(
                        Uri.parse(data['manageAccountsUrl']?.toString() ??
                            'https://connect.dropxlogistics.com'),
                        mode: LaunchMode.externalApplication,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(children: [
                    Text('Claim history',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w900)),
                    const Spacer(),
                    Text('${expenses.length} claim(s)',
                        style: const TextStyle(color: Color(0xff667085))),
                  ]),
                  const SizedBox(height: 6),
                  if (expenses.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(22),
                        child: Column(children: [
                          Icon(Icons.receipt_long_outlined,
                              size: 36, color: Color(0xff98a2b3)),
                          SizedBox(height: 8),
                          Text('No travel claims yet',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                          SizedBox(height: 4),
                          Text(
                              'Today’s claim is added while completing your field-duty report.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Color(0xff667085))),
                        ]),
                      ),
                    )
                  else
                    ...expenses.map((raw) {
                      final item = raw as Map<String, dynamic>;
                      final payment =
                          item['payment'] as Map<String, dynamic>? ?? const {};
                      return Card(
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xffffe7ef),
                            child: Text(
                                '₹${payment['amount_requested'] ?? payment['amount'] ?? 0}',
                                style: const TextStyle(
                                    color: dropxPink,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w900)),
                          ),
                          title: Text(
                              item['field_travel_expense_types']?['name']
                                      ?.toString() ??
                                  'Travel expense',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w800)),
                          subtitle: Text(
                              '${item['stations']?['station_code'] ?? '—'} · ${statusLabel(item['status']?.toString() ?? '')}${payment['utr_cin'] == null ? '' : ' · UTR ${payment['utr_cin']}'}'),
                          trailing: _StatusPill(
                              status:
                                  item['status']?.toString() ?? 'submitted'),
                        ),
                      );
                    }),
                ],
              ),
            );
          },
        ),
      );
}

class _EndFieldDutyForm extends StatefulWidget {
  const _EndFieldDutyForm({
    required this.token,
    required this.dutyId,
    required this.duty,
    required this.expenseData,
    required this.locations,
    required this.hasContacts,
    required this.currentPosition,
  });
  final String token;
  final String dutyId;
  final Map<String, dynamic> duty;
  final Map<String, dynamic> expenseData;
  final List<dynamic> locations;
  final bool hasContacts;
  final Future<Position?> Function() currentPosition;
  @override
  State<_EndFieldDutyForm> createState() => _EndFieldDutyFormState();
}

class _EndFieldDutyFormState extends State<_EndFieldDutyForm> {
  final _target = TextEditingController();
  final _joinees = TextEditingController();
  final _challenges = TextEditingController();
  final _plan = TextEditingController();
  final _remarks = TextEditingController();
  final _zeroReason = TextEditingController();
  final _hotspotName = TextEditingController();
  final _expenseAmount = TextEditingController();
  String _hotspotType = 'college';
  String? _expenseTypeId;
  String? _payoutAccountId;
  XFile? _expenseReceipt;
  final List<Map<String, String>> _hotspots = [];
  final List<Map<String, dynamic>> _expenses = [];
  final Set<String> _tomorrowLocations = {};
  bool _busy = false;
  bool _dutyClosed = false;
  String? _error;

  List<Map<String, dynamic>> get _expenseTypes =>
      (widget.expenseData['expenseTypes'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();

  @override
  void initState() {
    super.initState();
    _dutyClosed = widget.duty['status']?.toString() == 'completed';
    _expenseTypeId =
        _expenseTypes.isEmpty ? null : _expenseTypes.first['id']?.toString();
    final accounts =
        (widget.expenseData['bankAccounts'] as List<dynamic>? ?? const []);
    final selected = accounts.cast<Map<String, dynamic>?>().firstWhere(
          (item) => item?['isDefault'] == true,
          orElse: () =>
              accounts.isEmpty ? null : accounts.first as Map<String, dynamic>,
        );
    _payoutAccountId = selected?['id']?.toString() ??
        (widget.expenseData['bank'] as Map<String, dynamic>?)?['id']
            ?.toString();
  }

  @override
  void dispose() {
    _target.dispose();
    _joinees.dispose();
    _challenges.dispose();
    _plan.dispose();
    _remarks.dispose();
    _zeroReason.dispose();
    _hotspotName.dispose();
    _expenseAmount.dispose();
    super.dispose();
  }

  void _addHotspot() {
    final name = _hotspotName.text.trim();
    if (name.length < 2 || _hotspots.length >= 12) return;
    setState(() {
      _hotspots.add({'name': name, 'type': _hotspotType});
      _hotspotName.clear();
    });
  }

  Future<void> _pickExpenseReceipt() async {
    final file = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 72,
      maxWidth: 1600,
      maxHeight: 1600,
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 2 * 1024 * 1024) {
      setState(() => _error = 'Receipt must be smaller than 2 MB.');
      return;
    }
    setState(() {
      _expenseReceipt = file;
      _error = null;
    });
  }

  Future<void> _addExpense() async {
    final amount = double.tryParse(_expenseAmount.text.trim());
    final receipt = _expenseReceipt;
    final expenseType = _expenseTypes.cast<Map<String, dynamic>?>().firstWhere(
          (item) => item?['id']?.toString() == _expenseTypeId,
          orElse: () => null,
        );
    if (amount == null ||
        amount <= 0 ||
        receipt == null ||
        expenseType == null) {
      setState(() => _error =
          'Choose the travel type, enter amount, and upload the receipt.');
      return;
    }
    final bytes = await receipt.readAsBytes();
    final lower = receipt.name.toLowerCase();
    final mime = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
    setState(() {
      _expenses.add({
        'clientExpenseId':
            '${widget.dutyId}-${DateTime.now().microsecondsSinceEpoch}',
        'expenseTypeId': _expenseTypeId,
        'expenseTypeName': expenseType['name']?.toString() ?? 'Travel',
        'amount': amount,
        'fileName': receipt.name,
        'receiptDataUrl': 'data:$mime;base64,${base64Encode(bytes)}',
        'payoutAccountId': _payoutAccountId,
      });
      _expenseAmount.clear();
      _expenseReceipt = null;
      _error = null;
    });
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = RecruitmentApi(baseUrl: apiBaseUrl);
      if (!_dutyClosed) {
        final position = await widget.currentPosition();
        await api.fieldDutyAction(widget.token, {
          'action': 'end',
          'dutyId': widget.dutyId,
          'tomorrowLocationIds': _tomorrowLocations.toList(),
          'tomorrowTarget': int.tryParse(_target.text),
          'expectedJoinees': int.tryParse(_joinees.text),
          'challenges': _challenges.text,
          'tomorrowPlan': _plan.text,
          'remarks': _remarks.text,
          'zeroActivityReason': _zeroReason.text,
          'hotspots': _hotspots,
          'latitude': position?.latitude,
          'longitude': position?.longitude,
        });
        _dutyClosed = true;
      }
      for (final expense in _expenses) {
        await api.submitFieldExpense(widget.token, {
          ...expense,
          'dutyId': widget.dutyId,
        });
      }
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 14,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 20),
      child: SingleChildScrollView(
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Complete daily report',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text('Major hotspots visited today',
              style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text(
              'Examples: colleges, clubs, markets, training centres or local events.',
              style: TextStyle(color: Color(0xff667085), fontSize: 11)),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _hotspotType,
            decoration: const InputDecoration(labelText: 'Hotspot type'),
            items: const [
              DropdownMenuItem(
                  value: 'college', child: Text('College / campus')),
              DropdownMenuItem(
                  value: 'training_institute',
                  child: Text('Training institute')),
              DropdownMenuItem(
                  value: 'club_community', child: Text('Club / community')),
              DropdownMenuItem(
                  value: 'market_transit',
                  child: Text('Market / transit point')),
              DropdownMenuItem(
                  value: 'event_camp', child: Text('Event / hiring camp')),
              DropdownMenuItem(value: 'other', child: Text('Other hotspot')),
            ],
            onChanged: (value) =>
                setState(() => _hotspotType = value ?? 'other'),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
                child: TextField(
              controller: _hotspotName,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Hotspot name'),
              onSubmitted: (_) => _addHotspot(),
            )),
            const SizedBox(width: 8),
            IconButton.filledTonal(
                onPressed: _addHotspot, icon: const Icon(Icons.add)),
          ]),
          if (_hotspots.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
                spacing: 6,
                runSpacing: 5,
                children: _hotspots
                    .asMap()
                    .entries
                    .map((entry) => InputChip(
                          label: Text(entry.value['name']!),
                          onDeleted: () =>
                              setState(() => _hotspots.removeAt(entry.key)),
                        ))
                    .toList()),
          ],
          const SizedBox(height: 18),
          const Text('Today’s travel expense',
              style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text(
              'Optional. Same-day submission only. Payment goes only to the verified payout account you select.',
              style: TextStyle(color: Color(0xff667085), fontSize: 11)),
          if ((widget.expenseData['bankAccounts'] as List<dynamic>? ?? const [])
              .isNotEmpty)
            DropdownButtonFormField<String>(
              value: _payoutAccountId,
              decoration: const InputDecoration(
                labelText: 'Verified payout account',
                prefixIcon: Icon(Icons.account_balance_outlined),
              ),
              items: (widget.expenseData['bankAccounts'] as List<dynamic>)
                  .whereType<Map<String, dynamic>>()
                  .map((bank) => DropdownMenuItem(
                        value: bank['id']?.toString(),
                        child: Text(
                          '${bank['label'] ?? 'Verified account'} · ${bank['maskedAccount'] ?? ''} · ${bank['ifsc'] ?? ''}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ))
                  .toList(),
              onChanged: (value) => setState(() => _payoutAccountId = value),
            )
          else if (widget.expenseData['bankAction'] != null)
            Card(
              color: const Color(0xfffff1f3),
              child: ListTile(
                leading: const Icon(Icons.error_outline, color: Colors.red),
                title: const Text('Bank profile action required'),
                subtitle: Text(widget.expenseData['bankAction'].toString()),
              ),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => launchUrl(
                Uri.parse(widget.expenseData['manageAccountsUrl']?.toString() ??
                    'https://connect.dropxlogistics.com'),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.add_card_outlined),
              label: const Text('Manage or add verified payout account'),
            ),
          ),
          const SizedBox(height: 10),
          Card(
            color: const Color(0xfff4f3ff),
            child: ListTile(
              leading: const Icon(Icons.location_on_outlined,
                  color: Color(0xff6941c6)),
              title: Text(
                '${widget.duty['primary_location_code'] ?? ''}${widget.duty['primary_location_code'] == null ? '' : ' — '}${widget.duty['primary_location_name'] ?? 'Approved duty location'}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                'Locked from ${widget.duty['primary_location_source'] == 'biometric_device' ? 'biometric punch-in device' : 'approved manual IN'} • cannot be changed',
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _expenseTypeId,
                decoration: const InputDecoration(labelText: 'Expense type'),
                items: _expenseTypes
                    .map((item) => DropdownMenuItem(
                          value: item['id']?.toString(),
                          child: Text(item['name']?.toString() ?? 'Travel'),
                        ))
                    .toList(),
                onChanged: (value) => setState(() => _expenseTypeId = value),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _expenseAmount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                    labelText: 'Amount', prefixText: '₹ '),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _pickExpenseReceipt,
                icon: const Icon(Icons.receipt_long_outlined),
                label: Text(_expenseReceipt?.name ?? 'Upload receipt'),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.tonalIcon(
              onPressed: _expenses.length >= 5 ? null : _addExpense,
              icon: const Icon(Icons.add),
              label: const Text('Add'),
            ),
          ]),
          if (_expenses.isNotEmpty) ...[
            const SizedBox(height: 8),
            ..._expenses.asMap().entries.map((entry) => Card(
                  margin: const EdgeInsets.only(bottom: 6),
                  child: ListTile(
                    dense: true,
                    leading:
                        const Icon(Icons.verified_outlined, color: dropxGreen),
                    title: Text(entry.value['expenseTypeName'].toString()),
                    subtitle: Text(entry.value['fileName'].toString()),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('₹${entry.value['amount']}',
                          style: const TextStyle(fontWeight: FontWeight.w900)),
                      IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () =>
                            setState(() => _expenses.removeAt(entry.key)),
                      ),
                    ]),
                  ),
                )),
          ],
          const SizedBox(height: 18),
          const Text('Tomorrow’s assigned station plan',
              style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 7),
          if (widget.locations.isEmpty)
            const Text(
                'No assigned locations are configured. Ask your manager to update access.',
                style: TextStyle(color: Colors.red))
          else
            Wrap(
                spacing: 7,
                runSpacing: 5,
                children: widget.locations.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  final id = item['id'].toString();
                  return FilterChip(
                    label: Text('${item['code']} — ${item['name']}'),
                    selected: _tomorrowLocations.contains(id),
                    onSelected: (selected) => setState(() => selected
                        ? _tomorrowLocations.add(id)
                        : _tomorrowLocations.remove(id)),
                  );
                }).toList()),
          const SizedBox(height: 12),
          TextField(
              controller: _target,
              keyboardType: TextInputType.number,
              decoration:
                  const InputDecoration(labelText: 'Tomorrow target contacts')),
          const SizedBox(height: 10),
          TextField(
              controller: _joinees,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Expected joinees')),
          const SizedBox(height: 10),
          TextField(
              controller: _challenges,
              maxLines: 2,
              decoration:
                  const InputDecoration(labelText: 'Challenges / support')),
          const SizedBox(height: 10),
          TextField(
              controller: _plan,
              maxLines: 2,
              decoration:
                  const InputDecoration(labelText: 'Plan for tomorrow')),
          const SizedBox(height: 10),
          TextField(
              controller: _remarks,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Remarks')),
          if (!widget.hasContacts) ...[
            const SizedBox(height: 10),
            TextField(
                controller: _zeroReason,
                maxLines: 2,
                decoration: const InputDecoration(
                    labelText: 'Reason for zero field contacts')),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy ? null : _save,
            icon: const Icon(Icons.check_circle_outline),
            label: Text(_busy
                ? 'Submitting…'
                : (_dutyClosed
                    ? 'Submit Today’s Expense'
                    : 'End Duty & Submit')),
          ),
        ]),
      ),
    );
  }
}

class _HomeIdentityHero extends StatelessWidget {
  const _HomeIdentityHero({
    required this.name,
    required this.workspace,
    required this.role,
    required this.functionName,
  });
  final String name;
  final String workspace;
  final String role;
  final String functionName;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xff172033), Color(0xff40345f), Color(0xff8f2859)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(22),
          boxShadow: const [
            BoxShadow(
                color: Color(0x26172033), blurRadius: 24, offset: Offset(0, 10))
          ],
        ),
        child: Row(children: [
          Container(
            width: 54,
            height: 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(.14),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: Colors.white.withOpacity(.16)),
            ),
            child: Text(name.isEmpty ? 'D' : name.substring(0, 1).toUpperCase(),
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 23,
                    fontWeight: FontWeight.w900)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                  functionName == 'field_recruiter'
                      ? 'TODAY’S FIELD MISSION'
                      : 'GOOD DAY',
                  style: const TextStyle(
                      color: Color(0xffffc4d5),
                      fontSize: 9,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w900)),
              const SizedBox(height: 3),
              Text(name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.w900)),
              const SizedBox(height: 3),
              Text('$workspace · $role · ${statusLabel(functionName)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(color: Color(0xffe7e4ed), fontSize: 11)),
            ]),
          ),
          const Icon(Icons.auto_graph_rounded, color: dropxOrange, size: 30),
        ]),
      );
}

class _WorkforceHomeDashboard extends StatelessWidget {
  const _WorkforceHomeDashboard({
    required this.data,
    required this.loading,
    required this.error,
    required this.fieldRecruiter,
    required this.openPlanning,
    required this.openPrimary,
    required this.openOnboarding,
  });
  final Map<String, dynamic>? data;
  final bool loading;
  final String? error;
  final bool fieldRecruiter;
  final VoidCallback openPlanning;
  final VoidCallback openPrimary;
  final VoidCallback openOnboarding;

  @override
  Widget build(BuildContext context) {
    final rows = data?['rows'] as List<dynamic>? ?? const [];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
              fieldRecruiter
                  ? 'Your assigned-station hiring picture'
                  : 'Today’s hiring picture',
              style:
                  const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
          const Text('Capacity adjusted for associates in training',
              style: TextStyle(color: Color(0xff667085), fontSize: 10)),
        ]),
        TextButton(onPressed: openPlanning, child: const Text('Open all')),
      ]),
      const SizedBox(height: 5),
      if (error != null)
        Card(
          color: const Color(0xfffff3f1),
          child: ListTile(
              leading: const Icon(Icons.cloud_off_outlined, color: Colors.red),
              title: const Text('Workforce plan unavailable'),
              subtitle: Text(error!)),
        )
      else
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: dropxBorder),
          ),
          child: Column(children: [
            Row(children: [
              Expanded(
                  child: _PlanningMetric(
                      label: 'Net hire',
                      value: loading ? '…' : '${data?['totalGap'] ?? 0}',
                      color: dropxPink,
                      icon: Icons.person_add_alt_1_outlined)),
              Expanded(
                  child: _PlanningMetric(
                      label: 'Training',
                      value: loading ? '…' : '${data?['totalTraining'] ?? 0}',
                      color: dropxPurple,
                      icon: Icons.school_outlined)),
              Expanded(
                  child: _PlanningMetric(
                      label: 'At risk',
                      value: loading ? '…' : '${data?['attritionRisk'] ?? 0}',
                      color: dropxOrange,
                      icon: Icons.warning_amber_rounded)),
            ]),
            if (!loading && rows.isNotEmpty) ...[
              const Divider(height: 22),
              ...rows
                  .where((raw) => (raw as Map)['netHiringNeed'] != 0)
                  .take(3)
                  .map((raw) {
                final row = raw as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(children: [
                    Container(
                      width: 47,
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                          color: const Color(0xffffedf2),
                          borderRadius: BorderRadius.circular(10)),
                      child: Text('${row['stationCode']}',
                          style: const TextStyle(
                              color: dropxPink,
                              fontSize: 10,
                              fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                        child: Text(
                            '${row['workload']} avg volume · ${row['currentHeadcount']}/${row['requiredHeadcount']} active',
                            style: const TextStyle(
                                color: Color(0xff475467), fontSize: 10))),
                    Text('${row['netHiringNeed']} hire',
                        style: const TextStyle(
                            color: dropxPink,
                            fontSize: 11,
                            fontWeight: FontWeight.w900)),
                  ]),
                );
              }),
            ],
          ]),
        ),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(
            child: _HomeQuickAction(
                label: fieldRecruiter ? 'Field mission' : 'Call leads',
                icon: fieldRecruiter
                    ? Icons.route_outlined
                    : Icons.phone_in_talk_outlined,
                color: dropxBlue,
                onTap: openPrimary)),
        const SizedBox(width: 8),
        Expanded(
            child: _HomeQuickAction(
                label: 'Onboard',
                icon: Icons.badge_outlined,
                color: dropxGreen,
                onTap: openOnboarding)),
        const SizedBox(width: 8),
        Expanded(
            child: _HomeQuickAction(
                label: 'Workforce plan',
                icon: Icons.donut_large_outlined,
                color: dropxPurple,
                onTap: openPlanning)),
      ]),
    ]);
  }
}

class _PlanningMetric extends StatelessWidget {
  const _PlanningMetric(
      {required this.label,
      required this.value,
      required this.color,
      required this.icon});
  final String label;
  final String value;
  final Color color;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Column(children: [
          Icon(icon, color: color, size: 21),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                  color: color, fontSize: 24, fontWeight: FontWeight.w900)),
          Text(label,
              style: const TextStyle(color: Color(0xff667085), fontSize: 9)),
        ]),
      );
}

class _HomeQuickAction extends StatelessWidget {
  const _HomeQuickAction(
      {required this.label,
      required this.icon,
      required this.color,
      required this.onTap});
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: color.withOpacity(.09),
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          borderRadius: BorderRadius.circular(15),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 7),
            child: Column(children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 5),
              Text(label,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: color, fontSize: 9, fontWeight: FontWeight.w800)),
            ]),
          ),
        ),
      );
}

class _WorkforcePlanningPage extends StatefulWidget {
  const _WorkforcePlanningPage({required this.token});
  final String token;
  @override
  State<_WorkforcePlanningPage> createState() => _WorkforcePlanningPageState();
}

class _WorkforcePlanningPageState extends State<_WorkforcePlanningPage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  String _view = 'stations';
  String _station = 'all';
  String _stage = 'all';
  late Future<Map<String, dynamic>> _result =
      _api.workforcePlanning(widget.token);

  void _refresh() =>
      setState(() => _result = _api.workforcePlanning(widget.token));

  Color _stageColor(String stage) {
    if (stage == 'training') return dropxPurple;
    if (stage == 'productive') return dropxGreen;
    if (stage == 'cooling') return dropxOrange;
    if (stage == 'attrition_risk' || stage == 'stopped') {
      return const Color(0xffd92d20);
    }
    return dropxBlue;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Workforce Plan'), actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))
        ]),
        body: FutureBuilder<Map<String, dynamic>>(
          future: _result,
          builder: (context, snapshot) {
            if (!snapshot.hasData && !snapshot.hasError) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(child: Text(snapshot.error.toString()));
            }
            final data = snapshot.data!;
            final rows = (data['rows'] as List<dynamic>? ?? const [])
                .where((raw) =>
                    _station == 'all' ||
                    (raw as Map<String, dynamic>)['stationCode'] == _station)
                .toList();
            final allAssociates =
                data['visibleAssociates'] as List<dynamic>? ?? const [];
            final associates = allAssociates.where((raw) {
              final row = raw as Map<String, dynamic>;
              final riskOnly = _view == 'risk'
                  ? ['cooling', 'attrition_risk', 'stopped']
                      .contains(row['stage'])
                  : true;
              return riskOnly &&
                  (_station == 'all' || row['stationCode'] == _station) &&
                  (_stage == 'all' || row['stage'] == _stage);
            }).toList();
            return RefreshIndicator(
              onRefresh: () async => _refresh(),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
                children: [
                  Container(
                    padding: const EdgeInsets.all(17),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [dropxInk, Color(0xff49335d), dropxPink]),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('CAPACITY × RECRUITMENT',
                              style: TextStyle(
                                  color: Color(0xffffcada),
                                  fontSize: 9,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 1)),
                          const SizedBox(height: 4),
                          const Text('Hire what operations will need',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w900)),
                          const SizedBox(height: 11),
                          Row(children: [
                            Expanded(
                                child: _DarkMetric(
                                    'Capacity gap', data['totalCapacityGap'])),
                            Expanded(
                                child: _DarkMetric(
                                    'Training', data['totalTraining'])),
                            Expanded(
                                child:
                                    _DarkMetric('Net hire', data['totalGap'])),
                            Expanded(
                                child: _DarkMetric(
                                    'At risk', data['attritionRisk'])),
                          ]),
                        ]),
                  ),
                  const SizedBox(height: 12),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'stations', label: Text('Stations')),
                      ButtonSegment(value: 'joiners', label: Text('Joiners')),
                      ButtonSegment(value: 'risk', label: Text('Risk')),
                    ],
                    selected: {_view},
                    onSelectionChanged: (value) =>
                        setState(() => _view = value.first),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: _station,
                    decoration: const InputDecoration(labelText: 'Station'),
                    items: [
                      const DropdownMenuItem(
                          value: 'all', child: Text('All permitted stations')),
                      ...(data['rows'] as List<dynamic>? ?? const [])
                          .map((raw) {
                        final row = raw as Map<String, dynamic>;
                        return DropdownMenuItem(
                            value: row['stationCode']?.toString(),
                            child: Text(
                                '${row['stationCode']} — ${row['stationName']}'));
                      })
                    ],
                    onChanged: (value) =>
                        setState(() => _station = value ?? 'all'),
                  ),
                  if (_view != 'stations') ...[
                    const SizedBox(height: 9),
                    DropdownButtonFormField<String>(
                      value: _stage,
                      decoration:
                          const InputDecoration(labelText: 'Lifecycle status'),
                      items: const [
                        DropdownMenuItem(
                            value: 'all', child: Text('All statuses')),
                        DropdownMenuItem(
                            value: 'scheduled', child: Text('Scheduled')),
                        DropdownMenuItem(
                            value: 'training', child: Text('Training')),
                        DropdownMenuItem(
                            value: 'productive', child: Text('Productive')),
                        DropdownMenuItem(
                            value: 'cooling', child: Text('Cooling')),
                        DropdownMenuItem(
                            value: 'attrition_risk',
                            child: Text('Attrition risk')),
                        DropdownMenuItem(
                            value: 'stopped', child: Text('Stopped')),
                      ],
                      onChanged: (value) =>
                          setState(() => _stage = value ?? 'all'),
                    ),
                  ],
                  const SizedBox(height: 12),
                  if (_view == 'stations')
                    ...rows.map((raw) {
                      final row = raw as Map<String, dynamic>;
                      final required =
                          (row['requiredHeadcount'] as num?)?.toDouble() ?? 0;
                      final covered =
                          ((row['currentHeadcount'] as num?)?.toDouble() ?? 0) +
                              ((row['trainingHeadcount'] as num?)?.toDouble() ??
                                  0);
                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(15),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 9, vertical: 7),
                                    decoration: BoxDecoration(
                                        color: const Color(0xffffedf2),
                                        borderRadius: BorderRadius.circular(9)),
                                    child: Text('${row['stationCode']}',
                                        style: const TextStyle(
                                            color: dropxPink,
                                            fontWeight: FontWeight.w900)),
                                  ),
                                  const SizedBox(width: 9),
                                  Expanded(
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                        Text('${row['stationName']}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w800)),
                                        Text(
                                            '${row['workload']} average volume',
                                            style: const TextStyle(
                                                color: Color(0xff667085),
                                                fontSize: 10)),
                                      ])),
                                  Text('${row['netHiringNeed']} hire',
                                      style: TextStyle(
                                          color: row['netHiringNeed'] > 0
                                              ? dropxPink
                                              : dropxGreen,
                                          fontSize: 16,
                                          fontWeight: FontWeight.w900)),
                                ]),
                                const SizedBox(height: 12),
                                LinearProgressIndicator(
                                  value: required <= 0
                                      ? 0
                                      : (covered / required)
                                          .clamp(0, 1)
                                          .toDouble(),
                                  minHeight: 7,
                                  borderRadius: BorderRadius.circular(9),
                                  backgroundColor: const Color(0xfff0edf4),
                                  color: row['netHiringNeed'] > 0
                                      ? dropxPink
                                      : dropxGreen,
                                ),
                                const SizedBox(height: 10),
                                Wrap(spacing: 8, runSpacing: 7, children: [
                                  _FactChip('Active', row['currentHeadcount'],
                                      dropxBlue),
                                  _FactChip('Required',
                                      row['requiredHeadcount'], dropxInk),
                                  _FactChip('Training',
                                      row['trainingHeadcount'], dropxPurple),
                                  _FactChip(
                                      'At risk',
                                      row['attritionRiskHeadcount'],
                                      dropxOrange),
                                ]),
                                const SizedBox(height: 9),
                                Text('${row['recommendation']}',
                                    style: const TextStyle(
                                        color: Color(0xff475467),
                                        fontSize: 11)),
                              ]),
                        ),
                      );
                    })
                  else
                    ...associates.map((raw) {
                      final item = raw as Map<String, dynamic>;
                      final stage = item['stage']?.toString() ?? 'training';
                      final color = _stageColor(stage);
                      return Card(
                        margin: const EdgeInsets.only(bottom: 9),
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(children: [
                                  CircleAvatar(
                                      backgroundColor: color.withOpacity(.12),
                                      child: Text(
                                          (item['fullName']?.toString() ?? 'A')
                                              .substring(0, 1),
                                          style: TextStyle(
                                              color: color,
                                              fontWeight: FontWeight.w900))),
                                  const SizedBox(width: 10),
                                  Expanded(
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                        Text('${item['fullName']}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w900)),
                                        Text(
                                            '${item['stationCode']} · ${item['dropxId'] ?? item['biometricId'] ?? 'ID pending'}',
                                            style: const TextStyle(
                                                color: Color(0xff667085),
                                                fontSize: 10)),
                                      ])),
                                  _LifecyclePill(stage: stage, color: color),
                                ]),
                                const SizedBox(height: 10),
                                Row(children: [
                                  Expanded(
                                      child: _AssociateFact('7-day delivery',
                                          item['deliveries7'])),
                                  Expanded(
                                      child: _AssociateFact('30-day delivery',
                                          item['deliveries30'])),
                                  Expanded(
                                      child: _AssociateFact(
                                          'Active days', item['activeDays30'])),
                                ]),
                                const SizedBox(height: 8),
                                Text('Initiated by ${item['initiatedBy']}',
                                    style: const TextStyle(
                                        color: Color(0xff667085), fontSize: 9)),
                              ]),
                        ),
                      );
                    }),
                  if ((_view == 'stations' ? rows : associates).isEmpty)
                    const Card(
                        child: ListTile(
                            title: Text(
                                'No records match the selected filters.'))),
                ],
              ),
            );
          },
        ),
      );
}

class _DarkMetric extends StatelessWidget {
  const _DarkMetric(this.label, this.value);
  final String label;
  final dynamic value;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${value ?? 0}',
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w900)),
          Text(label,
              style: const TextStyle(color: Color(0xffded9e8), fontSize: 8)),
        ],
      );
}

class _FactChip extends StatelessWidget {
  const _FactChip(this.label, this.value, this.color);
  final String label;
  final dynamic value;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
            color: color.withOpacity(.08),
            borderRadius: BorderRadius.circular(9)),
        child: Text('$label ${value ?? 0}',
            style: TextStyle(
                color: color, fontSize: 9, fontWeight: FontWeight.w800)),
      );
}

class _LifecyclePill extends StatelessWidget {
  const _LifecyclePill({required this.stage, required this.color});
  final String stage;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
            color: color.withOpacity(.1),
            borderRadius: BorderRadius.circular(999)),
        child: Text(statusLabel(stage),
            style: TextStyle(
                color: color, fontSize: 8, fontWeight: FontWeight.w900)),
      );
}

class _AssociateFact extends StatelessWidget {
  const _AssociateFact(this.label, this.value);
  final String label;
  final dynamic value;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${value ?? 0}',
              style:
                  const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          Text(label,
              style: const TextStyle(color: Color(0xff98a2b3), fontSize: 8)),
        ],
      );
}

class _MenuCard extends StatelessWidget {
  const _MenuCard(
      {required this.title, required this.subtitle, this.icon, this.onTap});
  final String title;
  final String subtitle;
  final IconData? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    const accents = [
      dropxBlue,
      dropxPurple,
      dropxGreen,
      dropxOrange,
      dropxPink
    ];
    final accent = accents[(icon?.codePoint ?? title.length) % accents.length];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: accent, width: 3)),
          gradient: LinearGradient(
            colors: [Colors.white, accent.withOpacity(.025)],
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
          ),
        ),
        child: ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          leading: icon == null
              ? null
              : Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: accent.withOpacity(.1),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: accent),
                ),
          title: Text(title,
              style: const TextStyle(
                  fontWeight: FontWeight.w700, color: dropxInk)),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xff667085), height: 1.25)),
          ),
          trailing: Icon(Icons.arrow_forward_ios_rounded,
              size: 15, color: accent.withOpacity(.75)),
          onTap: onTap,
        ),
      ),
    );
  }
}

class _WorkspaceBanner extends StatelessWidget {
  const _WorkspaceBanner({required this.stream, required this.functionName});
  final String stream;
  final String functionName;

  @override
  Widget build(BuildContext context) {
    final hr = stream == 'hr';
    final field = !hr && functionName == 'field_recruiter';
    final influencer = !hr && functionName == 'influencer';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: hr
              ? const [Color(0xff172033), Color(0xff344054)]
              : const [Color(0xffd82459), Color(0xffff6b88)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(children: [
        Icon(
            hr
                ? Icons.business_center
                : field
                    ? Icons.explore_outlined
                    : influencer
                        ? Icons.campaign_outlined
                        : Icons.delivery_dining,
            color: Colors.white,
            size: 34),
        const SizedBox(width: 14),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
                hr
                    ? 'HR recruitment'
                    : field
                        ? 'Build today’s local hiring pipeline'
                        : influencer
                            ? 'Turn local connections into real careers'
                            : 'Workforce recruitment',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            Text(
                hr
                    ? 'Screen profiles, coordinate interview rounds and manage offers.'
                    : field
                        ? 'Go where candidates are, start real conversations and turn local connections into successful joins.'
                        : influencer
                            ? 'Refer suitable candidates, follow every verified milestone and grow with each successful DA.'
                            : 'Call faster, schedule interviews and record joining details.',
                style: const TextStyle(color: Colors.white70)),
          ]),
        ),
      ]),
    );
  }
}

class _DanapMobilePage extends StatefulWidget {
  const _DanapMobilePage({required this.token});
  final String token;
  @override
  State<_DanapMobilePage> createState() => _DanapMobilePageState();
}

class _DanapMobilePageState extends State<_DanapMobilePage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  String _scope = 'mine';
  Future<Map<String, dynamic>> _load() =>
      _api.danapOnboarding(widget.token, scope: _scope);
  late Future<Map<String, dynamic>> _result = _load();
  void _refresh() => setState(() => _result = _load());
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('DA In-app Onboarding'), actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))
        ]),
        body: FutureBuilder<Map<String, dynamic>>(
            future: _result,
            builder: (context, snapshot) {
              if (!snapshot.hasData && !snapshot.hasError) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Center(child: Text(snapshot.error.toString()));
              }
              final data = snapshot.data!;
              final metrics = data['metrics'] as Map<String, dynamic>? ?? {};
              final records = data['records'] as List<dynamic>? ?? [];
              return RefreshIndicator(
                  onRefresh: () async => _refresh(),
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    if (data['canViewTeam'] == true ||
                        data['canViewAll'] == true)
                      SegmentedButton<String>(
                        segments: [
                          const ButtonSegment(
                              value: 'mine', label: Text('Mine')),
                          if (data['canViewTeam'] == true)
                            const ButtonSegment(
                                value: 'team', label: Text('Team')),
                          if (data['canViewAll'] == true)
                            const ButtonSegment(
                                value: 'all', label: Text('All')),
                        ],
                        selected: {_scope},
                        onSelectionChanged: (value) {
                          setState(() {
                            _scope = value.first;
                            _result = _load();
                          });
                        },
                      ),
                    if (data['canViewTeam'] == true ||
                        data['canViewAll'] == true)
                      const SizedBox(height: 10),
                    Row(children: [
                      Expanded(
                          child: _MiniMetric(
                              label: 'Pending',
                              value: metrics['pending'] ?? 0,
                              color: dropxOrange)),
                      const SizedBox(width: 8),
                      Expanded(
                          child: _MiniMetric(
                              label: 'Video',
                              value: metrics['videoPending'] ?? 0,
                              color: dropxPink)),
                      const SizedBox(width: 8),
                      Expanded(
                          child: _MiniMetric(
                              label: 'NSDA',
                              value: metrics['nsda'] ?? 0,
                              color: const Color(0xff7f56d9)))
                    ]),
                    const SizedBox(height: 10),
                    ...records.map((raw) {
                      final item = raw as Map<String, dynamic>;
                      return Card(
                          child: ListTile(
                              isThreeLine: true,
                              leading: CircleAvatar(
                                  backgroundColor: const Color(0xffffedf2),
                                  child: Text(
                                      (item['daName']?.toString() ?? 'D')
                                          .substring(0, 1)
                                          .toUpperCase(),
                                      style: const TextStyle(
                                          color: dropxPink,
                                          fontWeight: FontWeight.w800))),
                              title: Text(
                                  item['daName']?.toString() ?? 'Unnamed DA',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800)),
                              subtitle: Text(
                                  '${item['station'] ?? 'Unmapped'} • ${item['rabbitId'] ?? 'No email'}\n${statusLabel(item['dependency']?.toString() ?? 'other')} — ${item['actionItem'] ?? 'Review required'}'),
                              trailing: _StatusPill(
                                  status: item['clearanceStatus']?.toString() ??
                                      'pending')));
                    }),
                    if (records.isEmpty)
                      const Card(
                          child: ListTile(
                              title: Text(
                                  'No pending onboarding dependencies in your scope.')))
                  ]));
            }),
      );
}

class _MiniMetric extends StatelessWidget {
  const _MiniMetric(
      {required this.label, required this.value, required this.color});
  final String label;
  final dynamic value;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: dropxBorder)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(fontSize: 11, color: Color(0xff667085))),
        const SizedBox(height: 5),
        Text('$value',
            style: TextStyle(
                fontSize: 22, fontWeight: FontWeight.w900, color: color))
      ]));
}

class _InfluencerPerformancePage extends StatefulWidget {
  const _InfluencerPerformancePage({required this.token});
  final String token;

  @override
  State<_InfluencerPerformancePage> createState() =>
      _InfluencerPerformancePageState();
}

class _InfluencerPerformancePageState
    extends State<_InfluencerPerformancePage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  late DateTime _from = DateTime(DateTime.now().year, DateTime.now().month);
  late DateTime _to = DateTime.now();
  late Future<Map<String, dynamic>> _result = _load();

  String _date(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  Future<Map<String, dynamic>> _load() => _api.influencerPerformance(
        widget.token,
        from: _date(_from),
        to: _date(_to),
      );

  void _refresh() => setState(() => _result = _load());

  Future<void> _pickDate({required bool from}) async {
    final selected = await showDatePicker(
      context: context,
      initialDate: from ? _from : _to,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (selected == null) return;
    setState(() {
      if (from) {
        _from = selected;
        if (_from.isAfter(_to)) _to = selected;
      } else {
        _to = selected;
        if (_to.isBefore(_from)) _from = selected;
      }
      _result = _load();
    });
  }

  int _number(dynamic value) => (value as num?)?.toInt() ?? 0;

  String _money(dynamic value) => '₹${_number(value)}';

  Widget _metric(String label, dynamic value, IconData icon) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: dropxBorder),
        ),
        child: Row(children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: const Color(0xffffedf2),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 18, color: dropxPink),
          ),
          const SizedBox(width: 9),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('$value',
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w900)),
              Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 10,
                      color: Color(0xff667085),
                      fontWeight: FontWeight.w700)),
            ]),
          ),
        ]),
      );

  Widget _candidateCard(
      Map<String, dynamic> item, List<Map<String, dynamic>> milestones) {
    final activeDays = _number(item['activeDays']);
    final deliveries = _number(item['deliveries']);
    final maxDays = milestones.isEmpty
        ? 30
        : _number(milestones.last['activeDays']).clamp(1, 366);
    final completed = milestones
        .where((milestone) => activeDays >= _number(milestone['activeDays']))
        .toList();
    final completedDay =
        completed.isEmpty ? 0 : _number(completed.last['activeDays']);
    final daysRemaining = _number(item['daysRemaining']);
    final nextAmount = _number(item['nextMilestoneAmount']);
    final stage = item['candidateStage']?.toString() ??
        statusLabel(item['lifecycleStage']?.toString() ?? 'pending');
    return Container(
      margin: const EdgeInsets.only(bottom: 11),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: dropxBorder),
        boxShadow: const [
          BoxShadow(
              color: Color(0x0d101828), blurRadius: 12, offset: Offset(0, 5))
        ],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(
            backgroundColor: const Color(0xffffe7ee),
            foregroundColor: dropxPink,
            child: Text(
                (item['candidate']?.toString().trim().isNotEmpty == true
                        ? item['candidate'].toString().trim()[0]
                        : 'A')
                    .toUpperCase(),
                style: const TextStyle(fontWeight: FontWeight.w900)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item['candidate']?.toString() ?? 'Associate',
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w900)),
              const SizedBox(height: 2),
              Text(
                  '${item['station'] ?? 'Station pending'} · ${item['role'] ?? 'Role pending'}',
                  style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xff667085),
                      fontWeight: FontWeight.w600)),
            ]),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xffffedf2),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(stage,
                style: const TextStyle(
                    color: dropxPink,
                    fontSize: 9,
                    fontWeight: FontWeight.w900)),
          ),
        ]),
        const SizedBox(height: 13),
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: LinearProgressIndicator(
            minHeight: 8,
            value: (activeDays / maxDays).clamp(0, 1),
            backgroundColor: const Color(0xffffe7ee),
            valueColor: const AlwaysStoppedAnimation(dropxPink),
          ),
        ),
        const SizedBox(height: 11),
        Row(children: [
          Expanded(child: _smallFact('Active days', activeDays)),
          Expanded(child: _smallFact('Deliveries', deliveries)),
          Expanded(
              child: _smallFact('Milestone',
                  completedDay == 0 ? 'Not reached' : '${completedDay}d')),
          Expanded(child: _smallFact('Eligible', _money(item['earnedAmount']))),
        ]),
        const Divider(height: 22),
        Row(children: [
          const Icon(Icons.verified_outlined,
              size: 17, color: Color(0xff12a56a)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              nextAmount > 0
                  ? '$daysRemaining verified active day${daysRemaining == 1 ? '' : 's'} to the next ₹$nextAmount milestone'
                  : '30-day pilot milestone completed',
              style: const TextStyle(
                  fontSize: 11,
                  color: Color(0xff475467),
                  fontWeight: FontWeight.w700),
            ),
          ),
        ]),
      ]),
    );
  }

  Widget _smallFact(String label, dynamic value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$value',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w900)),
          const SizedBox(height: 2),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 8, color: Color(0xff667085))),
        ],
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Referrals & Milestones'),
        actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _result,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.cloud_off_outlined,
                      size: 40, color: dropxPink),
                  const SizedBox(height: 12),
                  Text(snapshot.error.toString(), textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _refresh, child: const Text('Retry')),
                ]),
              ),
            );
          }
          final data = snapshot.data!;
          final candidates = (data['lifecycle'] as List<dynamic>? ?? [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .toList();
          final milestones = ((data['influencerProgram'] as Map?)?['milestones']
                      as List<dynamic>? ??
                  [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .toList()
            ..sort((a, b) =>
                _number(a['activeDays']).compareTo(_number(b['activeDays'])));
          final joined =
              candidates.where((item) => item['joiningDate'] != null).length;
          int milestoneCount(int days) => candidates
              .where((item) => _number(item['activeDays']) >= days)
              .length;
          final eligible = candidates.fold<int>(
              0, (sum, item) => sum + _number(item['earnedAmount']));
          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView(
              padding: const EdgeInsets.all(14),
              children: [
                Container(
                  padding: const EdgeInsets.all(17),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                        colors: [dropxInk, Color(0xff51315f), dropxPink]),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('YOUR VERIFIED REFERRAL JOURNEY',
                            style: TextStyle(
                                color: Color(0xffffb8cc),
                                fontSize: 9,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1.1)),
                        const SizedBox(height: 7),
                        const Text(
                            'Connect talent. Create careers. Earn trust.',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 21,
                                height: 1.18,
                                fontWeight: FontWeight.w900)),
                        const SizedBox(height: 7),
                        const Text(
                            'Every candidate stays attributed to you. Rewards progress only on verified delivery working days.',
                            style: TextStyle(
                                color: Color(0xfff5e8ee),
                                fontSize: 11,
                                height: 1.35)),
                        const SizedBox(height: 12),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.white,
                                  side:
                                      const BorderSide(color: Colors.white54)),
                              onPressed: () => _pickDate(from: true),
                              icon: const Icon(Icons.calendar_today_outlined,
                                  size: 15),
                              label: Text(_date(_from),
                                  style: const TextStyle(fontSize: 10)),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.white,
                                  side:
                                      const BorderSide(color: Colors.white54)),
                              onPressed: () => _pickDate(from: false),
                              icon: const Icon(Icons.event_available_outlined,
                                  size: 15),
                              label: Text(_date(_to),
                                  style: const TextStyle(fontSize: 10)),
                            ),
                          ),
                        ]),
                      ]),
                ),
                const SizedBox(height: 12),
                GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                  childAspectRatio: 2.25,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    _metric('Referrals', candidates.length,
                        Icons.people_alt_outlined),
                    _metric('Joined', joined, Icons.handshake_outlined),
                    _metric('10 active days', milestoneCount(10),
                        Icons.looks_one_outlined),
                    _metric('20 active days', milestoneCount(20),
                        Icons.looks_two_outlined),
                    _metric('30 active days', milestoneCount(30),
                        Icons.workspace_premium_outlined),
                    _metric('Eligible value', '₹$eligible',
                        Icons.account_balance_wallet_outlined),
                  ],
                ),
                const SizedBox(height: 16),
                Row(children: [
                  const Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('My associate journeys',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w900)),
                          Text('Registration → joining → verified active days',
                              style: TextStyle(
                                  fontSize: 10, color: Color(0xff667085))),
                        ]),
                  ),
                  Text('${candidates.length}',
                      style: const TextStyle(
                          color: dropxPink, fontWeight: FontWeight.w900)),
                ]),
                const SizedBox(height: 10),
                ...candidates.map((item) => _candidateCard(item, milestones)),
                if (candidates.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(17),
                      border: Border.all(color: dropxBorder),
                    ),
                    child: const Column(children: [
                      Icon(Icons.person_search_outlined,
                          size: 40, color: dropxPink),
                      SizedBox(height: 10),
                      Text('No referrals in this period',
                          style: TextStyle(fontWeight: FontWeight.w900)),
                      SizedBox(height: 4),
                      Text(
                          'Start with one strong local referral. Its verified journey will appear here.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              fontSize: 11, color: Color(0xff667085))),
                    ]),
                  ),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PersonalPerformancePage extends StatefulWidget {
  const _PersonalPerformancePage(
      {required this.token, required this.functionName});
  final String token;
  final String functionName;

  @override
  State<_PersonalPerformancePage> createState() =>
      _PersonalPerformancePageState();
}

class _PersonalPerformancePageState extends State<_PersonalPerformancePage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  Map<String, dynamic>? _lastData;
  late DateTime _from = DateTime.now();
  late DateTime _to = DateTime.now();
  late DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  late Future<Map<String, dynamic>> _result = _load();

  String _day(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  String _monthValue(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}';
  Future<Map<String, dynamic>> _load() => _api.personalPerformance(
        widget.token,
        from: _day(_from),
        to: _day(_to),
        month: _monthValue(_month),
      );
  void _refresh() => setState(() => _result = _load());
  void _shareScorecard() {
    final data = _lastData;
    if (data == null) return;
    final metrics = data['metrics'] as Map<String, dynamic>? ?? {};
    final breakdown = data['breakdown'] as List<dynamic>? ?? [];
    final lines = <String>[
      'DropX ${widget.functionName == 'field_recruiter' ? 'Field Recruiter' : 'Telecaller'} Scorecard • ${_day(_from)}',
      'Attended ${metrics['attended'] ?? 0} | Interviews ${metrics['interviews'] ?? 0} | Call back ${metrics['callBack'] ?? 0} | No response ${metrics['noResponse'] ?? 0}',
      'Selected ${metrics['selected'] ?? 0} | Joined ${metrics['joined'] ?? 0} | MTD joined ${metrics['mtdJoined'] ?? 0}',
      ...breakdown.take(6).map((raw) {
        final item = raw as Map<String, dynamic>;
        final statuses = _statusEntries(item['statusCounts'], limit: 4)
            .map((entry) => '${statusLabel(entry.key)} ${entry.value}')
            .join(' · ');
        return '${item['station'] ?? '—'} / ${item['designation'] ?? '—'}: ${item['attended'] ?? 0} attended${statuses.isEmpty ? '' : ' · $statuses'}';
      })
    ];
    Share.share(lines.join('\n'), subject: 'DropX recruiter daily scorecard');
  }

  Future<void> _pick({required bool from, bool month = false}) async {
    final current = month ? _month : (from ? _from : _to);
    final selected = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 366)),
      initialDatePickerMode: month ? DatePickerMode.year : DatePickerMode.day,
    );
    if (selected == null) return;
    setState(() {
      if (month) {
        _month = DateTime(selected.year, selected.month);
      } else if (from) {
        _from = selected;
      } else {
        _to = selected;
      }
      _result = _load();
    });
  }

  List<MapEntry<String, int>> _statusEntries(dynamic raw, {int limit = 6}) {
    final counts = <String, int>{};
    if (raw is Map) {
      raw.forEach((key, value) =>
          counts[key.toString()] = (value as num?)?.toInt() ?? 0);
    } else if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          counts[item['status']?.toString() ?? 'no_status'] =
              (item['count'] as num?)?.toInt() ?? 0;
        }
      }
    }
    final ranked = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (ranked.length <= limit) return ranked;
    final visible = ranked.take(limit).toList();
    visible.add(MapEntry('others',
        ranked.skip(limit).fold<int>(0, (sum, item) => sum + item.value)));
    return visible;
  }

  Color _statusColor(String status) {
    if (['joined', 'selected', 'interview_completed'].contains(status)) {
      return const Color(0xff12a56a);
    }
    if (['interview_scheduled', 'interview_rescheduled', 'call_back']
        .contains(status)) return const Color(0xff7f56d9);
    if ([
      'no_response',
      'long_distance',
      'not_interested',
      'not_fit',
      'wrong_number'
    ].contains(status)) return const Color(0xffe05a3f);
    return dropxOrange;
  }

  Widget _stationScorecard(Map<String, dynamic> item) {
    final attended = (item['attended'] as num?)?.toInt() ?? 0;
    final statuses = _statusEntries(item['statusCounts'], limit: 5);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: dropxBorder)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(
                  color: const Color(0xffffedf2),
                  borderRadius: BorderRadius.circular(8)),
              child: Text(item['station']?.toString() ?? '—',
                  style: const TextStyle(
                      color: dropxPink,
                      fontWeight: FontWeight.w900,
                      fontSize: 12))),
          const SizedBox(width: 7),
          Expanded(
              child: Text(item['designation']?.toString() ?? 'Unmapped',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 12))),
          Text('$attended attended',
              style:
                  const TextStyle(fontWeight: FontWeight.w900, fontSize: 12)),
        ]),
        const SizedBox(height: 8),
        Wrap(
            spacing: 6,
            runSpacing: 6,
            children: statuses.map((entry) {
              final color = _statusColor(entry.key);
              return Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                  decoration: BoxDecoration(
                      color: color.withOpacity(.09),
                      borderRadius: BorderRadius.circular(8)),
                  child: RichText(
                      text: TextSpan(
                          style: TextStyle(color: color, fontSize: 10),
                          children: [
                        TextSpan(text: '${statusLabel(entry.key)} '),
                        TextSpan(
                            text: '${entry.value}',
                            style: const TextStyle(fontWeight: FontWeight.w900))
                      ])));
            }).toList()),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.functionName == 'field_recruiter'
            ? 'Field Recruiter Performance'
            : 'Telecaller Performance'),
        actions: [
          IconButton(
              tooltip: 'Share scorecard',
              onPressed: _shareScorecard,
              icon: const Icon(Icons.ios_share_outlined)),
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _result,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final data = snapshot.data!;
          _lastData = data;
          final metrics =
              data['metrics'] as Map<String, dynamic>? ?? <String, dynamic>{};
          final associates = data['associates'] as List<dynamic>? ?? [];
          final breakdown = data['breakdown'] as List<dynamic>? ?? [];
          final statuses = _statusEntries(data['statusBreakdown']);
          final mtd = data['mtdJourney'] as Map<String, dynamic>? ??
              <String, dynamic>{};
          final attended = (metrics['attended'] as num?)?.toInt() ?? 0;
          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: ListView(
              padding: const EdgeInsets.all(14),
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [dropxInk, Color(0xff49335d), dropxPink]),
                      borderRadius: BorderRadius.circular(18)),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            widget.functionName == 'field_recruiter'
                                ? 'DAILY FIELD RECRUITER REVIEW'
                                : 'DAILY TELECALLER REVIEW',
                            style: const TextStyle(
                                color: Color(0xffffcad9),
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1.1)),
                        const SizedBox(height: 5),
                        Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Expanded(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                    Text('$attended',
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 34,
                                            height: 1,
                                            fontWeight: FontWeight.w900)),
                                    const Text('leads attended today',
                                        style: TextStyle(
                                            color: Color(0xffe8e5ee),
                                            fontSize: 11))
                                  ])),
                              Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text('${metrics['mtdJoined'] ?? 0}',
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 24,
                                            fontWeight: FontWeight.w900)),
                                    Text('${_monthValue(_month)} MTD joined',
                                        style: const TextStyle(
                                            color: Color(0xffe8e5ee),
                                            fontSize: 10))
                                  ]),
                            ]),
                      ]),
                ),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  OutlinedButton.icon(
                      onPressed: () => _pick(from: true),
                      icon: const Icon(Icons.calendar_today),
                      label: Text('From ${_day(_from)}')),
                  OutlinedButton.icon(
                      onPressed: () => _pick(from: false),
                      icon: const Icon(Icons.event_available),
                      label: Text('To ${_day(_to)}')),
                  OutlinedButton.icon(
                      onPressed: () => _pick(from: true, month: true),
                      icon: const Icon(Icons.date_range),
                      label: Text('Month ${_monthValue(_month)}')),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  for (final entry in <MapEntry<String, dynamic>>[
                    MapEntry('Initiated', metrics['onboarded'] ?? 0),
                    MapEntry('Interviews', metrics['interviews'] ?? 0),
                    MapEntry('Call back', metrics['callBack'] ?? 0),
                    MapEntry('No response', metrics['noResponse'] ?? 0),
                    MapEntry('Joined', metrics['joined'] ?? 0)
                  ]) ...[
                    Expanded(
                        child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 9),
                            decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(11),
                                border: Border.all(color: dropxBorder)),
                            child: Column(children: [
                              Text('${entry.value}',
                                  style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w900)),
                              Text(entry.key,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                      fontSize: 9, color: Color(0xff667085)))
                            ]))),
                    if (entry.key != 'Joined') const SizedBox(width: 6),
                  ]
                ]),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: dropxBorder)),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const Expanded(
                              child: Text('Today’s outcome mix',
                                  style:
                                      TextStyle(fontWeight: FontWeight.w800))),
                          Text('$attended total',
                              style: const TextStyle(
                                  fontSize: 11, color: Color(0xff667085)))
                        ]),
                        const SizedBox(height: 9),
                        ...statuses.map((entry) {
                          final color = _statusColor(entry.key);
                          final share =
                              attended == 0 ? 0.0 : entry.value / attended;
                          return Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Row(children: [
                                SizedBox(
                                    width: 104,
                                    child: Text(statusLabel(entry.key),
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(fontSize: 10))),
                                Expanded(
                                    child: ClipRRect(
                                        borderRadius: BorderRadius.circular(99),
                                        child: LinearProgressIndicator(
                                            value: share.clamp(0, 1),
                                            minHeight: 6,
                                            color: color,
                                            backgroundColor:
                                                const Color(0xfff0f1f4)))),
                                const SizedBox(width: 8),
                                SizedBox(
                                    width: 24,
                                    child: Text('${entry.value}',
                                        textAlign: TextAlign.right,
                                        style: const TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w900)))
                              ]));
                        }),
                      ]),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                      color: const Color(0xfffff5f8),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xffffd2df))),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Expanded(
                            child: Text('${_monthValue(_month)} journey',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800)),
                          ),
                          Text('${mtd['conversion'] ?? 0}% conversion',
                              style: const TextStyle(
                                  color: dropxPink,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900)),
                        ]),
                        const SizedBox(height: 8),
                        Row(children: [
                          for (final entry in <MapEntry<String, dynamic>>[
                            MapEntry('Attended', mtd['attended'] ?? 0),
                            MapEntry('Interview', mtd['interviews'] ?? 0),
                            MapEntry('Selected', mtd['selected'] ?? 0),
                            MapEntry('Joined', mtd['joined'] ?? 0)
                          ])
                            Expanded(
                                child: Column(children: [
                              Text('${entry.value}',
                                  style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w900)),
                              Text(entry.key,
                                  style: const TextStyle(
                                      fontSize: 9, color: Color(0xff667085)))
                            ]))
                        ]),
                      ]),
                ),
                if (data['incentiveVisible'] != false)
                  Card(
                    color: const Color(0xffffedf2),
                    child: ListTile(
                      title: const Text('Monthly incentive',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(
                          '${data['qualifiedAssociates'] ?? 0} qualified • ${data['incentiveState'] ?? 'Provisional'}'),
                      trailing: Text('₹${data['estimatedIncentive'] ?? 0}',
                          style: const TextStyle(
                              color: dropxPink,
                              fontSize: 22,
                              fontWeight: FontWeight.w800)),
                    ),
                  ),
                const Padding(
                    padding: EdgeInsets.fromLTRB(2, 16, 2, 8),
                    child: Text('Station × designation',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w800))),
                if (breakdown.isEmpty)
                  const Card(
                      child:
                          ListTile(title: Text('No activity for this day.'))),
                ...breakdown.take(12).map((raw) =>
                    _stationScorecard(Map<String, dynamic>.from(raw as Map))),
                const Padding(
                  padding: EdgeInsets.fromLTRB(4, 16, 4, 8),
                  child: Text('My onboarded associates',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                ),
                ...associates.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  final daily = item['daily'] as List<dynamic>? ?? [];
                  final phone = item['phone']?.toString() ?? '';
                  return Card(
                    child: ExpansionTile(
                      title: Text(item['candidate']?.toString() ?? 'Associate',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(
                          '${item['employeeId'] ?? item['providerEmployeeId'] ?? 'ID pending'} • ${item['station'] ?? ''}'),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('${item['deliveries'] ?? 0}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w800)),
                          Text('${item['activeDays'] ?? 0} days',
                              style: const TextStyle(fontSize: 11)),
                        ],
                      ),
                      children: [
                        if (phone.isNotEmpty)
                          ListTile(
                            dense: true,
                            leading: const Icon(Icons.phone_outlined,
                                color: dropxGreen),
                            title: Text(phone,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800)),
                            subtitle: Text(
                                'Last active: ${item['lastActiveDate'] ?? 'No operations activity'} • ${item['retained30'] == true ? '30-day retained' : 'Retention in progress'}'),
                            trailing: FilledButton.tonalIcon(
                              onPressed: () => launchUrl(
                                  Uri(scheme: 'tel', path: phone),
                                  mode: LaunchMode.externalApplication),
                              icon: const Icon(Icons.call, size: 16),
                              label: const Text('Call'),
                            ),
                          ),
                        ...daily.map((row) => ListTile(
                              dense: true,
                              title: Text(row['date']?.toString() ?? ''),
                              trailing:
                                  Text('${row['deliveries'] ?? 0} deliveries'),
                            )),
                      ],
                    ),
                  );
                }),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _DashboardPage extends StatelessWidget {
  const _DashboardPage(
      {required this.token, required this.stream, required this.title});
  final String token;
  final String stream;
  final String title;

  @override
  Widget build(BuildContext context) {
    final api = RecruitmentApi(baseUrl: apiBaseUrl);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: FutureBuilder<Map<String, dynamic>>(
        future: api.dashboard(token, stream: stream),
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final metrics = snapshot.data!['metrics'] as Map<String, dynamic>;
          final adPendency =
              ((snapshot.data!['adDesignationPendency'] as List<dynamic>?) ??
                      const <dynamic>[])
                  .whereType<Map>()
                  .map((row) => Map<String, dynamic>.from(row))
                  .toList();
          String statusText(dynamic value) {
            final raw = (value?.toString().trim().isNotEmpty ?? false)
                ? value.toString().trim()
                : 'not active';
            return raw
                .replaceAll('_', ' ')
                .split(' ')
                .map((part) => part.isEmpty
                    ? part
                    : '${part[0].toUpperCase()}${part.substring(1)}')
                .join(' ');
          }

          Color statusColor(dynamic value) {
            switch (value?.toString().toLowerCase()) {
              case 'active':
                return const Color(0xff067647);
              case 'paused':
                return const Color(0xff925800);
              case 'disapproved':
              case 'rejected':
              case 'inactive':
              case 'not_active':
                return const Color(0xffb42318);
              default:
                return const Color(0xff475467);
            }
          }

          const labels = <String, String>{
            'total': 'Total Leads',
            'noStatus': 'No Status',
            'noResponse': 'No Response',
            'callBack': 'Call Back',
            'interviews': 'Interviews',
            'joined': 'Joined',
            'pending24h': '24H+ Pending',
            'unmapped': 'Unmapped',
          };
          const metricStatus = <String, String?>{
            'total': null,
            'noStatus': '__BLANK__',
            'noResponse': 'no_response',
            'callBack': 'call_back',
            'interviews': 'interview_scheduled,interview_rescheduled',
            'joined': 'joined',
            'pending24h': null,
            'unmapped': null,
          };
          const metricColors = <String, Color>{
            'total': dropxInk,
            'noStatus': Color(0xffc0282a),
            'noResponse': Color(0xffe09200),
            'callBack': dropxPink,
            'interviews': Color(0xff12a55e),
            'joined': dropxInk,
            'pending24h': Color(0xffc0282a),
            'unmapped': Color(0xff7f56d9),
          };
          Widget metricGrid(List<String> keys) => GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.62,
                children: keys.map((key) {
                  final entry = MapEntry(key, labels[key]!);
                  return Card(
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => _LeadListPage(
                            token: token,
                            stream: stream,
                            title: entry.value,
                            status: metricStatus[entry.key],
                            stale24: entry.key == 'pending24h',
                            unmapped: entry.key == 'unmapped',
                          ),
                        ),
                      ),
                      child: Container(
                        decoration: BoxDecoration(
                            border: Border(
                                top: BorderSide(
                                    color: metricColors[entry.key]!,
                                    width: 3))),
                        padding: const EdgeInsets.all(14),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(entry.value,
                                  style: const TextStyle(
                                      color: Color(0xff667085),
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700)),
                              const Spacer(),
                              Text('${metrics[entry.key] ?? 0}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineMedium
                                      ?.copyWith(
                                          color: metricColors[entry.key],
                                          fontWeight: FontWeight.w800)),
                              const Text('Open queue →',
                                  style: TextStyle(
                                      color: Color(0xff98a2b3), fontSize: 10)),
                            ]),
                      ),
                    ),
                  );
                }).toList(),
              );
          return ListView(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(17),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [dropxInk, Color(0xff49335d), dropxPink],
                  ),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('RECRUITMENT COMMAND CENTER',
                        style: TextStyle(
                            color: Color(0xffffcada),
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.05)),
                    SizedBox(height: 5),
                    Text('Source. Connect. Hire. Scale.',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900)),
                    SizedBox(height: 4),
                    Text('Today’s pipeline and the work that needs action.',
                        style:
                            TextStyle(color: Color(0xffe7e4ed), fontSize: 11)),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(3, 17, 3, 7),
                child: Text('Action queue',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
              ),
              metricGrid(
                  ['interviews', 'callBack', 'noResponse', 'pending24h']),
              const Padding(
                padding: EdgeInsets.fromLTRB(3, 17, 3, 7),
                child: Text('Pipeline health',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
              ),
              metricGrid(['total', 'noStatus', 'joined', 'unmapped']),
              const Padding(
                padding: EdgeInsets.fromLTRB(3, 17, 3, 2),
                child: Text('Designation pendency by ad',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(3, 0, 3, 7),
                child: Text('Current ad status and open lead workload.',
                    style: TextStyle(color: Color(0xff667085), fontSize: 10)),
              ),
              if (adPendency.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(14),
                    child: Text('No ads are mapped to this scope.'),
                  ),
                ),
              ...adPendency.map((row) {
                final status = row['adStatus'];
                final pending = int.tryParse('${row['pending'] ?? 0}') ?? 0;
                return Card(
                  margin: const EdgeInsets.only(bottom: 7),
                  clipBehavior: Clip.antiAlias,
                  child: ExpansionTile(
                    tilePadding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    title: Text(row['adName']?.toString() ?? 'Unnamed ad',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w800)),
                    subtitle: Text(
                        '${row['station'] ?? 'Unmapped'} · ${row['designation'] ?? 'Unmapped'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Color(0xff667085), fontSize: 9)),
                    trailing: SizedBox(
                      width: 88,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('$pending pending',
                              style: TextStyle(
                                  color: pending > 0
                                      ? const Color(0xffb42318)
                                      : const Color(0xff067647),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900)),
                          const SizedBox(height: 3),
                          Text(statusText(status),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  color: statusColor(status),
                                  fontSize: 8,
                                  fontWeight: FontWeight.w800)),
                        ],
                      ),
                    ),
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xfff7f8fa),
                          borderRadius: BorderRadius.circular(9),
                        ),
                        child: Wrap(
                          spacing: 16,
                          runSpacing: 9,
                          children: [
                            _CompactFact('No status', row['noStatus']),
                            _CompactFact('No response', row['noResponse']),
                            _CompactFact('Call back', row['callBack']),
                            _CompactFact('24h+', row['stale24h']),
                            _CompactFact('Total leads', row['totalLeads']),
                            _CompactFact('Station', row['stationName']),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          );
        },
      ),
    );
  }
}

class _CompactFact extends StatelessWidget {
  const _CompactFact(this.label, this.value);
  final String label;
  final dynamic value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 92,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  color: Color(0xff98a2b3),
                  fontSize: 7,
                  fontWeight: FontWeight.w900)),
          const SizedBox(height: 2),
          Text('${value ?? '—'}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(fontSize: 10, fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}

class _FieldExecutiveOnboardingPage extends StatefulWidget {
  const _FieldExecutiveOnboardingPage(
      {required this.token, this.influencerMode = false});
  final String token;
  final bool influencerMode;
  @override
  State<_FieldExecutiveOnboardingPage> createState() =>
      _FieldExecutiveOnboardingPageState();
}

class _FieldExecutiveOnboardingPageState
    extends State<_FieldExecutiveOnboardingPage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  final _search = TextEditingController();
  String _scope = 'mine';
  int _page = 1;
  List<String> _statuses = [];
  List<String> _stations = [];
  List<String> _designations = [];
  late Future<Map<String, dynamic>> _results = _load();
  late final Future<Map<String, dynamic>> _options =
      _api.fieldExecutives(widget.token, scope: 'mine', page: 1);

  Future<Map<String, dynamic>> _load() => _api.fieldExecutives(widget.token,
      scope: _scope,
      page: _page,
      search: _search.text,
      statuses: _statuses,
      stations: _stations,
      designations: _designations);

  void _refresh({int? page}) => setState(() {
        if (page != null) _page = page;
        _results = _load();
      });

  Future<void> _showFilters(Map<String, dynamic> data) async {
    final result = await showModalBottomSheet<Map<String, List<String>>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FieldExecutiveFilters(
        statuses: _statuses,
        stations: _stations,
        designations: _designations,
        facets: Map<String, dynamic>.from(data['facets'] as Map? ?? {}),
      ),
    );
    if (result == null) return;
    setState(() {
      _statuses = result['statuses'] ?? [];
      _stations = result['stations'] ?? [];
      _designations = result['designations'] ?? [];
      _page = 1;
      _results = _load();
    });
  }

  Future<void> _showCreateForm() async {
    final options = await _options;
    if (!mounted) return;
    final master = Map<String, dynamic>.from(options['master'] as Map? ?? {});
    final locations = (master['locations'] as List<dynamic>? ?? [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final roles = (master['designations'] as List<dynamic>? ?? [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final name = TextEditingController();
    final mobile = TextEditingController();
    final email = TextEditingController();
    var joiningDate = DateTime.now();
    String? station;
    String? designation;
    var submitting = false;
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => StatefulBuilder(builder: (_, setSheetState) {
        final stationLabels = locations
            .map((item) => '${item['code']} — ${item['name']}')
            .toList();
        final designationLabels =
            roles.map((item) => '${item['code']} — ${item['name']}').toList();
        return Padding(
          padding: EdgeInsets.fromLTRB(
              16, 18, 16, MediaQuery.viewInsetsOf(sheetContext).bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                Expanded(
                    child: Text(
                        widget.influencerMode
                            ? 'Refer an Associate'
                            : 'Onboard Field Executive',
                        style: const TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w800))),
                IconButton(
                    onPressed: () => Navigator.pop(sheetContext),
                    icon: const Icon(Icons.close))
              ]),
              TextField(
                  controller: name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Full name')),
              const SizedBox(height: 10),
              TextField(
                  controller: mobile,
                  keyboardType: TextInputType.phone,
                  maxLength: 10,
                  decoration: const InputDecoration(
                      labelText: 'Candidate mobile number')),
              TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 10),
              Autocomplete<String>(
                optionsBuilder: (value) => stationLabels.where((item) =>
                    item.toLowerCase().contains(value.text.toLowerCase())),
                onSelected: (value) =>
                    station = value.split(' — ').first.trim(),
                fieldViewBuilder: (_, controller, focus, submit) => TextField(
                    controller: controller,
                    focusNode: focus,
                    decoration: InputDecoration(
                        labelText: widget.influencerMode
                            ? 'Preferred work station'
                            : 'Search station')),
              ),
              const SizedBox(height: 10),
              Autocomplete<String>(
                optionsBuilder: (value) => designationLabels.where((item) =>
                    item.toLowerCase().contains(value.text.toLowerCase())),
                onSelected: (value) =>
                    designation = value.split(' — ').skip(1).join(' — ').trim(),
                fieldViewBuilder: (_, controller, focus, submit) => TextField(
                    controller: controller,
                    focusNode: focus,
                    decoration: InputDecoration(
                        labelText: widget.influencerMode
                            ? 'Role interested in'
                            : 'Search designation')),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () async {
                  final picked = await showDatePicker(
                      context: sheetContext,
                      firstDate: DateTime(2020),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                      initialDate: joiningDate);
                  if (picked != null) {
                    setSheetState(() => joiningDate = picked);
                  }
                },
                icon: const Icon(Icons.calendar_month),
                label: Text(
                    '${widget.influencerMode ? 'Expected joining' : 'Joining'}: ${joiningDate.day}/${joiningDate.month}/${joiningDate.year}'),
              ),
              const SizedBox(height: 16),
              SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                      onPressed: submitting
                          ? null
                          : () async {
                              final messenger = ScaffoldMessenger.of(context);
                              if (name.text.trim().isEmpty ||
                                  !RegExp(r'^\d{10}$')
                                      .hasMatch(mobile.text.trim()) ||
                                  !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                      .hasMatch(email.text.trim()) ||
                                  station == null ||
                                  designation == null) {
                                messenger.showSnackBar(const SnackBar(
                                    content: Text(
                                        'Enter name, a 10-digit mobile, valid email, station and designation.')));
                                return;
                              }
                              setSheetState(() => submitting = true);
                              try {
                                final date =
                                    '${joiningDate.year.toString().padLeft(4, '0')}-${joiningDate.month.toString().padLeft(2, '0')}-${joiningDate.day.toString().padLeft(2, '0')}';
                                final result = await _api.createFieldExecutive(
                                    widget.token,
                                    fullName: name.text,
                                    mobile: mobile.text,
                                    email: email.text,
                                    joiningDate: date,
                                    locationCode: station ?? '',
                                    designation: designation ?? '');
                                if (!sheetContext.mounted) return;
                                Navigator.pop(sheetContext, true);
                                messenger.showSnackBar(SnackBar(
                                    content: Text(
                                        '${result['message']} ${result['created']?['dropxId'] ?? ''}')));
                              } catch (error) {
                                if (sheetContext.mounted) {
                                  setSheetState(() => submitting = false);
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(SnackBar(
                                          content: Text(error.toString())));
                                }
                              }
                            },
                      child: submitting
                          ? const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                  SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2)),
                                  SizedBox(width: 10),
                                  Text('Submitting securely…')
                                ])
                          : Text(widget.influencerMode
                              ? 'Submit Referral'
                              : 'Create Field Executive')))
            ]),
          ),
        );
      }),
    );
    name.dispose();
    mobile.dispose();
    email.dispose();
    if (created == true) {
      setState(() {
        _scope = 'mine';
        _page = 1;
        _results = _load();
      });
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.influencerMode
            ? 'My Associate Referrals'
            : 'Field Executive Onboarding'),
        actions: [
          IconButton(
              onPressed: _showCreateForm,
              tooltip: widget.influencerMode
                  ? 'Refer an Associate'
                  : 'Onboard Field Executive',
              icon: const Icon(Icons.person_add_alt_1))
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
          onPressed: _showCreateForm,
          icon: const Icon(Icons.add),
          label: Text(widget.influencerMode ? 'Refer' : 'Onboard')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _results,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final data = snapshot.data!;
          final rows = data['executives'] as List<dynamic>? ?? [];
          final total = data['total'] as int? ?? 0;
          return Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: SegmentedButton<String>(
                segments: [
                  const ButtonSegment(value: 'mine', label: Text('Mine')),
                  if (data['canViewTeam'] == true)
                    const ButtonSegment(value: 'team', label: Text('Team')),
                  if (data['canViewAll'] == true)
                    const ButtonSegment(value: 'all', label: Text('All')),
                ],
                selected: {_scope},
                onSelectionChanged: (value) => setState(() {
                  _scope = value.first;
                  _page = 1;
                  _results = _load();
                }),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Row(children: [
                Expanded(
                    child: TextField(
                  controller: _search,
                  onSubmitted: (_) => _refresh(page: 1),
                  decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Name, mobile, DropX or biometric ID'),
                )),
                const SizedBox(width: 8),
                Badge(
                  isLabelVisible: _statuses.isNotEmpty ||
                      _stations.isNotEmpty ||
                      _designations.isNotEmpty,
                  label: Text(
                      '${_statuses.length + _stations.length + _designations.length}'),
                  child: IconButton.filledTonal(
                      onPressed: () => _showFilters(data),
                      icon: const Icon(Icons.tune)),
                )
              ]),
            ),
            Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                        widget.influencerMode
                            ? '$total referrals • Only candidates attributed to you'
                            : '$total associates • My Initiations by default',
                        style: const TextStyle(
                            color: Color(0xff667085),
                            fontWeight: FontWeight.w700)))),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: ListView.builder(
                  padding: const EdgeInsets.only(top: 8, bottom: 88),
                  itemCount: rows.length,
                  itemBuilder: (_, index) {
                    final item = Map<String, dynamic>.from(rows[index] as Map);
                    final station =
                        item['stations'] as Map<String, dynamic>? ?? {};
                    return Card(
                      margin: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 5),
                      child: ListTile(
                        isThreeLine: true,
                        leading: CircleAvatar(
                            child: Text((item['full_name'] ?? 'F')
                                .toString()
                                .substring(0, 1)
                                .toUpperCase())),
                        title: Text(item['full_name'] ?? 'Field Executive',
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Text(
                            '+${item['mobile_country_code'] ?? '91'} ${item['mobile']}\n'
                            '${item['dropx_id'] ?? 'DropX ID pending'} • ${station['station_code'] ?? '—'} • ${item['designation'] ?? '—'}'),
                        trailing: _StatusPill(
                            status: item['is_active'] == false
                                ? 'inactive'
                                : item['onboarding_status']?.toString() ??
                                    'pending'),
                      ),
                    );
                  },
                ),
              ),
            ),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(
                  onPressed: _page > 1 ? () => _refresh(page: _page - 1) : null,
                  icon: const Icon(Icons.chevron_left)),
              Text('Page $_page'),
              IconButton(
                  onPressed: _page * 50 < total
                      ? () => _refresh(page: _page + 1)
                      : null,
                  icon: const Icon(Icons.chevron_right)),
            ])
          ]);
        },
      ),
    );
  }
}

class _FieldExecutiveFilters extends StatefulWidget {
  const _FieldExecutiveFilters(
      {required this.statuses,
      required this.stations,
      required this.designations,
      required this.facets});
  final List<String> statuses;
  final List<String> stations;
  final List<String> designations;
  final Map<String, dynamic> facets;
  @override
  State<_FieldExecutiveFilters> createState() => _FieldExecutiveFiltersState();
}

class _FieldExecutiveFiltersState extends State<_FieldExecutiveFilters> {
  late final Set<String> statuses = widget.statuses.toSet();
  late final Set<String> stations = widget.stations.toSet();
  late final Set<String> designations = widget.designations.toSet();
  String query = '';
  List<String> values(String key) =>
      (widget.facets[key] as List<dynamic>? ?? [])
          .map((value) => value.toString())
          .where((value) => value.toLowerCase().contains(query.toLowerCase()))
          .toList();
  Widget group(String title, Set<String> selected, List<String> items) =>
      ExpansionTile(
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle:
            Text(selected.isEmpty ? 'All' : '${selected.length} selected'),
        children: [
          Wrap(
              spacing: 6,
              children: items
                  .map((value) => FilterChip(
                      label: Text(statusLabel(value)),
                      selected: selected.contains(value),
                      onSelected: (checked) => setState(() => checked
                          ? selected.add(value)
                          : selected.remove(value))))
                  .toList()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(
                  onPressed: () => setState(() => selected.addAll(items)),
                  child: const Text('Select all')),
              TextButton(
                  onPressed: () => setState(selected.clear),
                  child: const Text('Clear')),
            ]),
          )
        ],
      );
  @override
  Widget build(BuildContext context) => FractionallySizedBox(
        heightFactor: .82,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              const Expanded(
                  child: Text('Filter Associate History',
                      style: TextStyle(
                          fontSize: 19, fontWeight: FontWeight.w800))),
              TextButton(
                  onPressed: () => setState(() {
                        statuses.clear();
                        stations.clear();
                        designations.clear();
                      }),
                  child: const Text('Reset'))
            ]),
          ),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: TextField(
                  onChanged: (value) => setState(() => query = value),
                  decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Search filter options'))),
          Expanded(
              child: ListView(children: [
            group('Status', statuses, values('statuses')),
            group('Stations', stations, values('stations')),
            group('Designations', designations, values('designations')),
          ])),
          SafeArea(
              top: false,
              minimum: const EdgeInsets.all(14),
              child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                      onPressed: () => Navigator.pop(context, {
                            'statuses': statuses.toList(),
                            'stations': stations.toList(),
                            'designations': designations.toList()
                          }),
                      child: const Text('Apply filters'))))
        ]),
      );
}

class _LeadListPage extends StatefulWidget {
  const _LeadListPage(
      {required this.token,
      required this.stream,
      required this.title,
      this.status,
      this.archive = 'active',
      this.unmapped = false,
      this.stale24 = false});
  final String token;
  final String stream;
  final String title;
  final String? status;
  final String archive;
  final bool unmapped;
  final bool stale24;

  @override
  State<_LeadListPage> createState() => _LeadListPageState();
}

class _LeadListPageState extends State<_LeadListPage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  final _search = TextEditingController();
  int _page = 1;
  List<String> _stations = [];
  List<String> _clusters = [];
  List<String> _roles = [];
  late List<String> _statuses =
      widget.status?.split(',').where((value) => value.isNotEmpty).toList() ??
          <String>[];
  Map<String, dynamic> _facets = const {};
  List<Map<String, dynamic>> _workforceStatuses = const [];
  late String? _interviewFrom =
      widget.title.toLowerCase().contains('interview') ? _today() : null;
  late String? _interviewTo =
      widget.title.toLowerCase().contains('interview') ? _today() : null;
  late Future<Map<String, dynamic>> _results = _load();

  String get _menu {
    final title = widget.title.toLowerCase();
    if (widget.archive == 'archived') return 'Archived Leads';
    if (widget.unmapped) return 'Unmapped';
    if (title.contains('no response') || title.contains('call back')) {
      return 'No Response / Call Back';
    }
    if (title.contains('screening')) return 'Screening';
    if (title.contains('interview') || title == 'joining') return 'Interviews';
    if (title.contains('selection') || title.contains('offer')) return 'Offers';
    if (title == 'joined' || title.contains('hired')) return 'Hired';
    return 'All Leads';
  }

  @override
  void initState() {
    super.initState();
    _loadStatusMaster();
  }

  Future<void> _loadStatusMaster() async {
    if (widget.stream != 'workforce') return;
    try {
      final data = await _api.options(widget.token);
      final rows = (data['workforceStatuses'] as List<dynamic>? ?? [])
          .map((item) => Map<String, dynamic>.from(item as Map))
          .where((item) => item['isActive'] != false)
          .toList();
      final locations = (data['locations'] as List<dynamic>? ?? [])
          .map((raw) => Map<String, dynamic>.from(raw as Map))
          .toList();
      final roles = (data['roles'] as List<dynamic>? ?? [])
          .map((raw) => Map<String, dynamic>.from(raw as Map))
          .toList();
      if (mounted) {
        setState(() {
          _workforceStatuses = rows;
          _facets = {
            'stations': locations
                .map((item) => {'value': item['code'], 'count': ''})
                .toList(),
            'clusters': locations
                .map((item) => item['cluster']?.toString())
                .where((value) => value?.isNotEmpty == true)
                .toSet()
                .map((value) => {'value': value, 'count': ''})
                .toList(),
            'roles': roles
                .map((item) => {'value': item['code'], 'count': ''})
                .toList(),
          };
        });
      }
    } catch (_) {}
  }

  static String _today() {
    final value = DateTime.now();
    return '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  }

  Future<Map<String, dynamic>> _load({bool includeFacets = false}) =>
      _api.leads(widget.token,
          page: _page,
          stream: widget.stream,
          status: _statuses.isEmpty ? null : _statuses.join(','),
          search: _search.text,
          stations: _stations,
          clusters: _clusters,
          roles: _roles,
          archive: widget.archive,
          unmapped: widget.unmapped,
          stale24: widget.stale24,
          facets: includeFacets,
          interviewFrom: _interviewFrom,
          interviewTo: _interviewTo,
          menu: _menu);

  Future<void> _pickInterviewDate(bool from) async {
    final current =
        DateTime.tryParse((from ? _interviewFrom : _interviewTo) ?? _today()) ??
            DateTime.now();
    final selected = await showDatePicker(
        context: context,
        initialDate: current,
        firstDate: DateTime(2020),
        lastDate: DateTime.now().add(const Duration(days: 730)));
    if (selected == null) return;
    final value =
        '${selected.year.toString().padLeft(4, '0')}-${selected.month.toString().padLeft(2, '0')}-${selected.day.toString().padLeft(2, '0')}';
    setState(() {
      if (from) {
        _interviewFrom = value;
      } else {
        _interviewTo = value;
      }
      _page = 1;
      _results = _load();
    });
  }

  void _refresh({int? page}) => setState(() {
        if (page != null) _page = page;
        _results = _load();
      });

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  int get _filterCount =>
      _statuses.length + _stations.length + _clusters.length + _roles.length;

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<_LeadFilters>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _LeadFilterSheet(
        facets: _facets,
        stream: widget.stream,
        statuses: _statuses,
        stations: _stations,
        clusters: _clusters,
        roles: _roles,
        workforceStatuses: _workforceStatuses,
      ),
    );
    if (result == null) return;
    setState(() {
      _stations = result.stations;
      _clusters = result.clusters;
      _roles = result.roles;
      _statuses = result.statuses;
      _page = 1;
      _results = _load();
    });
  }

  Future<void> _launchPhone(String? raw, {bool whatsapp = false}) async {
    var digits = (raw ?? '').replaceAll(RegExp(r'\D'), '');
    if (digits.length > 10 && digits.startsWith('91')) {
      digits = digits.substring(2);
    }
    if (digits.length != 10) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('This lead has no valid mobile number.')));
      return;
    }
    final uri = whatsapp
        ? Uri.parse('https://wa.me/91$digits')
        : Uri.parse('tel:+91$digits');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unable to open this action.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
              tooltip: 'Refresh',
              onPressed: () => _refresh(page: 1),
              icon: const Icon(Icons.refresh)),
        ],
      ),
      body: Column(children: [
        if (_interviewFrom != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: Row(children: [
              Expanded(
                  child: OutlinedButton(
                      onPressed: () => _pickInterviewDate(true),
                      child: Text('From $_interviewFrom'))),
              const SizedBox(width: 8),
              Expanded(
                  child: OutlinedButton(
                      onPressed: () => _pickInterviewDate(false),
                      child: Text('To $_interviewTo'))),
            ]),
          ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _refresh(page: 1),
                decoration: InputDecoration(
                  hintText: 'Name, phone, email or ad',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            _search.clear();
                            _refresh(page: 1);
                          }),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Badge(
              isLabelVisible: _filterCount > 0,
              label: Text('$_filterCount'),
              child: IconButton.filledTonal(
                tooltip: 'Filters',
                onPressed: _openFilters,
                icon: const Icon(Icons.tune),
              ),
            ),
          ]),
        ),
        Expanded(
            child: FutureBuilder<Map<String, dynamic>>(
          future: _results,
          builder: (context, snapshot) {
            if (!snapshot.hasData && !snapshot.hasError) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(child: Text(snapshot.error.toString()));
            }
            final leads = snapshot.data!['leads'] as List<dynamic>;
            final total = snapshot.data!['total'] as int;
            final refreshedFacets = snapshot.data!['facets'];
            if (refreshedFacets is Map<String, dynamic>) {
              _facets = refreshedFacets;
            }
            return Column(children: [
              Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(children: [
                    Expanded(
                        child: Text('$total unique leads',
                            style:
                                const TextStyle(fontWeight: FontWeight.w700))),
                    Text(widget.stream == 'hr' ? 'HR' : 'WORKFORCE',
                        style: const TextStyle(
                            color: dropxPink,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1)),
                  ])),
              Expanded(
                  child: RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: ListView.builder(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: leads.length,
                  itemBuilder: (context, index) {
                    final lead = leads[index] as Map<String, dynamic>;
                    final role =
                        lead['recruitment_roles'] as Map<String, dynamic>?;
                    final location =
                        lead['recruitment_locations'] as Map<String, dynamic>?;
                    final phone = lead['phone']?.toString();
                    return Card(
                        margin: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 4),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: () async {
                            await Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => _LeadDetailPage(
                                  token: widget.token,
                                  stream: widget.stream,
                                  menu: _menu,
                                  leadId: lead['id'].toString(),
                                  allowJoining: widget.title
                                      .toLowerCase()
                                      .contains('interview'),
                                  updateStatus: () => _showStatusUpdate(lead),
                                ),
                              ),
                            );
                            _refresh();
                          },
                          onLongPress: () => _showStatusUpdate(lead),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(11, 10, 9, 9),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(children: [
                                  Expanded(
                                    child: Text(
                                        lead['full_name']?.toString() ??
                                            'Unnamed',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                            fontSize: 14)),
                                  ),
                                  _StatusPill(
                                      status:
                                          lead['status']?.toString() ?? 'new'),
                                  const Icon(Icons.chevron_right, size: 18),
                                ]),
                                const SizedBox(height: 5),
                                Row(children: [
                                  const Icon(Icons.phone_outlined,
                                      size: 15, color: dropxPink),
                                  const SizedBox(width: 5),
                                  Expanded(
                                      child: Text(
                                          phone?.isNotEmpty == true
                                              ? phone!
                                              : 'No phone',
                                          maxLines: 1,
                                          style: const TextStyle(
                                              color: dropxInk,
                                              fontWeight: FontWeight.w900,
                                              fontSize: 15,
                                              letterSpacing: .1))),
                                ]),
                                const SizedBox(height: 5),
                                Row(children: [
                                  const Icon(Icons.work_outline,
                                      size: 14, color: Color(0xff8a94a6)),
                                  const SizedBox(width: 5),
                                  Expanded(
                                      child: Text(
                                          '${location?['code'] ?? 'Unmapped'} • ${role?['name'] ?? 'Unmapped designation'}',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w700,
                                              color: Color(0xff475467)))),
                                ]),
                                if ((lead['city']
                                            ?.toString()
                                            .trim()
                                            .isNotEmpty ??
                                        false) ||
                                    (lead['post_code']
                                            ?.toString()
                                            .trim()
                                            .isNotEmpty ??
                                        false))
                                  Padding(
                                      padding: const EdgeInsets.only(top: 3),
                                      child: Row(children: [
                                        const Icon(Icons.location_on_outlined,
                                            size: 14, color: Color(0xff8a94a6)),
                                        const SizedBox(width: 5),
                                        Expanded(
                                            child: Text(
                                                [
                                                  lead['city'],
                                                  lead['post_code']
                                                ]
                                                    .where((value) =>
                                                        value
                                                            ?.toString()
                                                            .trim()
                                                            .isNotEmpty ==
                                                        true)
                                                    .join(' • '),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                    fontSize: 10,
                                                    color: Color(0xff667085)))),
                                      ])),
                                if (widget.stream == 'workforce') ...[
                                  const SizedBox(height: 7),
                                  Row(children: [
                                    SizedBox(
                                        height: 34,
                                        child: OutlinedButton.icon(
                                          onPressed: () => _launchPhone(phone),
                                          icon:
                                              const Icon(Icons.call, size: 15),
                                          label: const Text('Call'),
                                        )),
                                    const SizedBox(width: 6),
                                    SizedBox(
                                        height: 34,
                                        child: OutlinedButton.icon(
                                          onPressed: () => _launchPhone(phone,
                                              whatsapp: true),
                                          icon: const Icon(Icons.chat_outlined,
                                              size: 15),
                                          label: const Text('WA'),
                                        )),
                                    const Spacer(),
                                    IconButton.filledTonal(
                                      constraints:
                                          const BoxConstraints.tightFor(
                                              width: 36, height: 34),
                                      padding: EdgeInsets.zero,
                                      tooltip: 'Update status',
                                      onPressed: () => _showStatusUpdate(lead),
                                      icon:
                                          const Icon(Icons.edit_note, size: 20),
                                    ),
                                  ]),
                                ],
                              ],
                            ),
                          ),
                        ));
                  },
                ),
              )),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                IconButton(
                    onPressed:
                        _page > 1 ? () => _refresh(page: _page - 1) : null,
                    icon: const Icon(Icons.chevron_left)),
                Text('Page $_page'),
                IconButton(
                    onPressed: _page * 50 < total
                        ? () => _refresh(page: _page + 1)
                        : null,
                    icon: const Icon(Icons.chevron_right)),
              ]),
            ]);
          },
        )),
      ]),
    );
  }

  Future<void> _showStatusUpdate(Map<String, dynamic> lead) async {
    final currentStatus = lead['status']?.toString() ?? '';
    final configured = _workforceStatuses.isNotEmpty
        ? _workforceStatuses
        : workforceQuickStatuses
            .map((code) => <String, dynamic>{
                  'code': code,
                  'label': statusLabel(code),
                  'requiresSchedule': const [
                    'call_back',
                    'interview_scheduled',
                    'interview_rescheduled'
                  ].contains(code),
                  'scheduleType': code == 'call_back'
                      ? 'callback'
                      : code.startsWith('interview_')
                          ? 'interview'
                          : null
                })
            .toList();
    final statuses = <String>{
      if (const ['no_response', 'call_back'].contains(currentStatus))
        currentStatus,
      if (widget.stream == 'workforce')
        ...configured.map((item) => item['code'].toString())
      else
        ...(leadTransitions[currentStatus] ?? leadTransitions['new']!)
    }
        .where((value) =>
            value != currentStatus ||
            const ['no_response', 'call_back'].contains(value))
        .toList();
    String selected = statuses.first;
    String remarks = '';
    bool retry = const ['no_response', 'call_back'].contains(currentStatus);
    DateTime? actionAt = DateTime.tryParse(
      (currentStatus == 'call_back'
                  ? lead['callback_at']
                  : lead['follow_up_at'])
              ?.toString() ??
          '',
    )?.toLocal();
    final decision = await showDialog<_LeadUpdateDecision>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(lead['full_name']?.toString() ?? 'Update lead'),
        content: StatefulBuilder(builder: (context, setDialogState) {
          final selectedConfig =
              configured.cast<Map<String, dynamic>?>().firstWhere(
                    (item) => item?['code'] == selected,
                    orElse: () => null,
                  );
          final needsDate = selectedConfig?['requiresSchedule'] == true;
          Future<void> pickDateTime() async {
            final now = DateTime.now();
            final date = await showDatePicker(
              context: context,
              firstDate: DateTime(now.year - 1),
              lastDate: DateTime(now.year + 2),
              initialDate: actionAt ?? now,
            );
            if (date == null || !context.mounted) return;
            final time = await showTimePicker(
              context: context,
              initialTime: TimeOfDay.fromDateTime(actionAt ?? now),
            );
            if (time == null) return;
            setDialogState(() {
              actionAt = DateTime(
                  date.year, date.month, date.day, time.hour, time.minute);
            });
          }

          return SingleChildScrollView(
              child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: selected,
                decoration: const InputDecoration(
                    labelText: 'Next status', border: OutlineInputBorder()),
                items: statuses
                    .map((status) => DropdownMenuItem(
                        value: status,
                        child: Text(configured
                                .cast<Map<String, dynamic>?>()
                                .firstWhere((item) => item?['code'] == status,
                                    orElse: () => null)?['label']
                                ?.toString() ??
                            statusLabel(status))))
                    .toList(),
                onChanged: (value) => setDialogState(() {
                  selected = value ?? selected;
                  retry = selected == currentStatus &&
                      const ['no_response', 'call_back'].contains(selected);
                  actionAt = DateTime.tryParse(
                    (selected == 'call_back'
                                ? lead['callback_at']
                                : lead['follow_up_at'])
                            ?.toString() ??
                        '',
                  )?.toLocal();
                }),
              ),
              if (retry)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Record another contact attempt'),
                  value: retry,
                  onChanged: (value) => setDialogState(() => retry = value),
                ),
              if (needsDate) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: pickDateTime,
                  icon: const Icon(Icons.event),
                  label: Text(actionAt == null
                      ? (selected == 'call_back'
                          ? 'Set callback time'
                          : 'Set interview time')
                      : '${actionAt!.day}/${actionAt!.month}/${actionAt!.year} '
                          '${actionAt!.hour.toString().padLeft(2, '0')}:${actionAt!.minute.toString().padLeft(2, '0')}'),
                ),
              ],
              const SizedBox(height: 12),
              TextFormField(
                decoration: const InputDecoration(
                    labelText: 'Remarks', border: OutlineInputBorder()),
                maxLines: 3,
                onChanged: (value) => remarks = value,
              ),
            ],
          ));
        }),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final selectedConfig = configured
                  .cast<Map<String, dynamic>?>()
                  .firstWhere((item) => item?['code'] == selected,
                      orElse: () => null);
              final needsDate = selectedConfig?['requiresSchedule'] == true;
              if (needsDate && actionAt == null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                      content: Text(
                          'Select the callback or interview date and time.')),
                );
                return;
              }
              Navigator.pop(
                  context,
                  _LeadUpdateDecision(
                    status: selected,
                    remarks: remarks,
                    retry: retry,
                    actionAt: actionAt,
                  ));
            },
            child: Text(retry ? 'Record attempt' : 'Update'),
          ),
        ],
      ),
    );
    if (decision == null) return;
    if (decision.status == currentStatus && !decision.retry) return;
    try {
      await _api.updateStatus(
        widget.token,
        leadId: lead['id'].toString(),
        status: decision.status,
        remarks: decision.remarks,
        retry: decision.retry,
        callbackAt: configured.cast<Map<String, dynamic>?>().firstWhere(
                    (item) => item?['code'] == decision.status,
                    orElse: () => null)?['scheduleType'] ==
                'callback'
            ? decision.actionAt?.toUtc().toIso8601String()
            : null,
        interviewAt: configured.cast<Map<String, dynamic>?>().firstWhere(
                    (item) => item?['code'] == decision.status,
                    orElse: () => null)?['scheduleType'] ==
                'interview'
            ? decision.actionAt?.toUtc().toIso8601String()
            : null,
        menu: _menu,
      );
      _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }
}

class _LeadFilters {
  const _LeadFilters(
      {required this.statuses,
      required this.stations,
      required this.clusters,
      required this.roles});
  final List<String> statuses;
  final List<String> stations;
  final List<String> clusters;
  final List<String> roles;
}

class _LeadFilterSheet extends StatefulWidget {
  const _LeadFilterSheet({
    required this.facets,
    required this.stream,
    required this.statuses,
    required this.stations,
    required this.clusters,
    required this.roles,
    required this.workforceStatuses,
  });
  final Map<String, dynamic> facets;
  final String stream;
  final List<String> statuses;
  final List<String> stations;
  final List<String> clusters;
  final List<String> roles;
  final List<Map<String, dynamic>> workforceStatuses;

  @override
  State<_LeadFilterSheet> createState() => _LeadFilterSheetState();
}

class _LeadFilterSheetState extends State<_LeadFilterSheet> {
  late final Set<String> _statuses = widget.statuses.toSet();
  late final Set<String> _stations = widget.stations.toSet();
  late final Set<String> _clusters = widget.clusters.toSet();
  late final Set<String> _roles = widget.roles.toSet();
  final _search = TextEditingController();
  String _query = '';

  List<Map<String, dynamic>> _items(String key) {
    final source = key == 'statuses'
        ? (widget.stream == 'workforce'
                ? (widget.workforceStatuses.isNotEmpty
                    ? widget.workforceStatuses
                        .map((item) => item['code'].toString())
                        .toList()
                    : workforceQuickStatuses)
                : leadTransitions.values
                    .expand((items) => items)
                    .toSet()
                    .toList())
            .map((value) => {'value': value, 'count': ''})
            .toList()
        : (widget.facets[key] as List<dynamic>? ?? []);
    return source
        .map((item) => Map<String, dynamic>.from(item as Map))
        .where((item) => item['value']
            .toString()
            .toLowerCase()
            .contains(_query.toLowerCase()))
        .toList();
  }

  ExpansionPanelRadio _panel({
    required String keyName,
    required String title,
    required Set<String> selected,
  }) {
    final items = _items(keyName);
    final visibleValues =
        items.map((item) => item['value'].toString()).toList();
    return ExpansionPanelRadio(
      value: keyName,
      headerBuilder: (_, open) => ListTile(
        dense: true,
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle:
            Text(selected.isEmpty ? 'All' : '${selected.length} selected'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          child: TextField(
            controller: _search,
            onChanged: (value) => setState(() => _query = value),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search ${title.toLowerCase()}',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      onPressed: () {
                        _search.clear();
                        setState(() => _query = '');
                      },
                      icon: const Icon(Icons.close)),
            ),
          ),
        ),
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 260),
          child: items.isEmpty
              ? const Center(
                  child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Text('No matching options.')))
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: items.length,
                  itemBuilder: (_, index) {
                    final item = items[index];
                    final value = item['value'].toString();
                    return CheckboxListTile(
                      dense: true,
                      value: selected.contains(value),
                      title: Text(value),
                      secondary: Text('${item['count'] ?? 0}'),
                      onChanged: (checked) => setState(() {
                        checked == true
                            ? selected.add(value)
                            : selected.remove(value);
                      }),
                    );
                  }),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton(
                onPressed: visibleValues.isEmpty
                    ? null
                    : () => setState(() => selected.addAll(visibleValues)),
                child: Text(_query.isEmpty ? 'Select all' : 'Select shown')),
            TextButton(
                onPressed:
                    selected.isEmpty ? null : () => setState(selected.clear),
                child: const Text('Clear')),
          ]),
        ),
      ]),
    );
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      heightFactor: .88,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 8, 8),
          child: Row(children: [
            const Expanded(
                child: Text('Filter leads',
                    style:
                        TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
            TextButton(
                onPressed: () => setState(() {
                      _stations.clear();
                      _clusters.clear();
                      _roles.clear();
                      _statuses.clear();
                    }),
                child: const Text('Reset')),
            IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close)),
          ]),
        ),
        const Divider(height: 1),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(12),
            child: ExpansionPanelList.radio(
              elevation: 0,
              expandedHeaderPadding: EdgeInsets.zero,
              expansionCallback: (_, __) {
                _search.clear();
                setState(() => _query = '');
              },
              children: [
                _panel(
                    keyName: 'statuses', title: 'Status', selected: _statuses),
                _panel(
                    keyName: 'locations',
                    title: 'Stations',
                    selected: _stations),
                _panel(
                    keyName: 'clusters',
                    title: 'Clusters',
                    selected: _clusters),
                _panel(
                    keyName: 'roles', title: 'Designations', selected: _roles),
              ],
            ),
          ),
        ),
        SafeArea(
          top: false,
          minimum: const EdgeInsets.all(14),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => Navigator.pop(
                  context,
                  _LeadFilters(
                      statuses: _statuses.toList(),
                      stations: _stations.toList(),
                      clusters: _clusters.toList(),
                      roles: _roles.toList())),
              icon: const Icon(Icons.check),
              label: const Text('Apply filters'),
            ),
          ),
        ),
      ]),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final normalized = status.isEmpty ? 'new' : status;
    final positiveStatuses = {
      'interview_scheduled',
      'interview_rescheduled',
      'interview_completed',
      'selected',
      'joined',
    };
    final negativeStatuses = {
      'rejected',
      'not_interested',
      'not_fit',
      'wrong_number',
      'long_distance',
    };
    final attentionStatuses = {
      'no_response',
      'call_back',
      'document_issue',
    };
    final color = positiveStatuses.contains(normalized)
        ? const Color(0xff079455)
        : attentionStatuses.contains(normalized)
            ? const Color(0xffdc6803)
            : negativeStatuses.contains(normalized)
                ? const Color(0xffd92d20)
                : const Color(0xff475467);
    return Container(
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
          color: color.withOpacity(.1),
          borderRadius: BorderRadius.circular(20)),
      child: Text(statusLabel(normalized),
          maxLines: 2,
          softWrap: true,
          textAlign: TextAlign.center,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

class _HrScreeningCard extends StatefulWidget {
  const _HrScreeningCard({
    required this.token,
    required this.leadId,
    required this.initialSummary,
    required this.onSaved,
  });
  final String token;
  final String leadId;
  final String initialSummary;
  final VoidCallback onSaved;

  @override
  State<_HrScreeningCard> createState() => _HrScreeningCardState();
}

class _HrScreeningCardState extends State<_HrScreeningCard> {
  late final _summary = TextEditingController(text: widget.initialSummary);
  final _currentSalary = TextEditingController();
  final _expectedSalary = TextEditingController();
  final _noticePeriod = TextEditingController();
  bool _saving = false;

  Future<void> _save() async {
    if (_summary.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Add a screening summary.')));
      return;
    }
    setState(() => _saving = true);
    try {
      final result = await RecruitmentApi(baseUrl: apiBaseUrl).saveHrWorkflow(
        widget.token,
        leadId: widget.leadId,
        values: {
          'action': 'profile',
          'summary': _summary.text.trim(),
          'currentSalary': _currentSalary.text.trim(),
          'expectedSalary': _expectedSalary.text.trim(),
          'noticePeriod': _noticePeriod.text.trim(),
        },
      );
      widget.onSaved();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(result['message'] ?? 'Screening saved.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _summary.dispose();
    _currentSalary.dispose();
    _expectedSalary.dispose();
    _noticePeriod.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('HR screening',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text(
              'Capture the recruiter assessment before interview rounds.',
              style: TextStyle(color: Color(0xff667085))),
          const SizedBox(height: 14),
          TextField(
            controller: _summary,
            maxLines: 4,
            decoration: const InputDecoration(
                labelText: 'Recruiter summary',
                hintText: 'Fit, experience, communication and role notes'),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
                child: TextField(
                    controller: _currentSalary,
                    decoration:
                        const InputDecoration(labelText: 'Current salary'))),
            const SizedBox(width: 8),
            Expanded(
                child: TextField(
                    controller: _expectedSalary,
                    decoration:
                        const InputDecoration(labelText: 'Expected salary'))),
          ]),
          const SizedBox(height: 10),
          TextField(
              controller: _noticePeriod,
              decoration:
                  const InputDecoration(labelText: 'Notice / availability')),
          const SizedBox(height: 12),
          FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: Text(_saving ? 'Saving…' : 'Save screening')),
        ]),
      ),
    );
  }
}

class _JoiningCard extends StatefulWidget {
  const _JoiningCard({
    required this.token,
    required this.leadId,
    required this.lead,
    required this.history,
    required this.onSaved,
  });
  final String token;
  final String leadId;
  final Map<String, dynamic> lead;
  final List<dynamic> history;
  final VoidCallback onSaved;

  @override
  State<_JoiningCard> createState() => _JoiningCardState();
}

class _JoiningCardState extends State<_JoiningCard> {
  late final _fullName =
      TextEditingController(text: widget.lead['full_name']?.toString() ?? '');
  late final _mobile = TextEditingController(
      text: (widget.lead['phone']?.toString() ?? '')
          .replaceAll(RegExp(r'\D'), '')
          .replaceFirst(RegExp(r'^91(?=\d{10}$)'), ''));
  late final _email =
      TextEditingController(text: widget.lead['email']?.toString() ?? '');
  final _employeeId = TextEditingController();
  final _providerId = TextEditingController();
  final _companyId = TextEditingController();
  final _paymentRecommendation = TextEditingController();
  late DateTime _joiningDate = DateTime.now();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final latest = widget.history.cast<dynamic>().where((raw) =>
        (raw as Map<String, dynamic>)['event_type'] ==
        'workforce_joining_record');
    if (latest.isNotEmpty) {
      final item = latest.first as Map<String, dynamic>;
      final metadata =
          item['metadata'] as Map<String, dynamic>? ?? <String, dynamic>{};
      _employeeId.text = metadata['employee_id']?.toString() ?? '';
      _providerId.text = metadata['provider_employee_id']?.toString() ?? '';
      _companyId.text = metadata['company_id_value']?.toString() ?? '';
      _paymentRecommendation.text =
          metadata['payment_recommendation']?.toString() ?? '';
      _joiningDate =
          DateTime.tryParse(metadata['joining_date']?.toString() ?? '') ??
              DateTime.now();
    }
  }

  String get _date =>
      '${_joiningDate.year.toString().padLeft(4, '0')}-${_joiningDate.month.toString().padLeft(2, '0')}-${_joiningDate.day.toString().padLeft(2, '0')}';

  Future<void> _save() async {
    if (_fullName.text.trim().isEmpty ||
        _mobile.text.replaceAll(RegExp(r'\D'), '').length != 10 ||
        !_email.text.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Enter name, valid mobile number and email.')));
      return;
    }
    setState(() => _saving = true);
    try {
      final result = await RecruitmentApi(baseUrl: apiBaseUrl).saveJoining(
        widget.token,
        leadId: widget.leadId,
        fullName: _fullName.text.trim(),
        mobile: _mobile.text.trim(),
        email: _email.text.trim(),
        joiningDate: _date,
        employeeId: _employeeId.text.trim(),
        providerEmployeeId: _providerId.text.trim(),
        companyIdValue: _companyId.text.trim(),
        paymentRecommendation: _paymentRecommendation.text.trim(),
      );
      widget.onSaved();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(result['message'] ?? 'Joining saved.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _fullName.dispose();
    _mobile.dispose();
    _email.dispose();
    _employeeId.dispose();
    _providerId.dispose();
    _companyId.dispose();
    _paymentRecommendation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Create Field Executive',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text(
              'Creates the shared operations profile and preserves recruiter ownership.',
              style: TextStyle(color: Color(0xff667085))),
          const SizedBox(height: 14),
          TextField(
              controller: _fullName,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Full name')),
          const SizedBox(height: 10),
          TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              decoration: const InputDecoration(labelText: 'Mobile number')),
          TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email')),
          const SizedBox(height: 10),
          TextField(
              controller: _employeeId,
              decoration:
                  const InputDecoration(labelText: 'DropX Employee ID')),
          const SizedBox(height: 10),
          TextField(
              controller: _providerId,
              decoration: const InputDecoration(
                  labelText: 'Amazon Rabbit / Provider ID')),
          const SizedBox(height: 10),
          TextField(
              controller: _companyId,
              decoration: const InputDecoration(labelText: 'Company ID')),
          const SizedBox(height: 10),
          TextField(
              controller: _paymentRecommendation,
              decoration: const InputDecoration(
                  labelText: 'Payment recommendation (approval required)')),
          const SizedBox(height: 10),
          OutlinedButton.icon(
              onPressed: () async {
                final date = await showDatePicker(
                    context: context,
                    initialDate: _joiningDate,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now().add(const Duration(days: 365)));
                if (date != null) setState(() => _joiningDate = date);
              },
              icon: const Icon(Icons.calendar_month_outlined),
              label: Text('Joining date: $_date')),
          const SizedBox(height: 12),
          FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.badge_outlined),
              label: Text(_saving ? 'Creating…' : 'Create Field Executive')),
        ]),
      ),
    );
  }
}

class _LeadDetailPage extends StatefulWidget {
  const _LeadDetailPage({
    required this.token,
    required this.stream,
    required this.menu,
    required this.leadId,
    required this.allowJoining,
    required this.updateStatus,
  });
  final String token;
  final String stream;
  final String menu;
  final String leadId;
  final bool allowJoining;
  final Future<void> Function() updateStatus;

  @override
  State<_LeadDetailPage> createState() => _LeadDetailPageState();
}

class _LeadDetailPageState extends State<_LeadDetailPage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  final _remarks = TextEditingController();
  final _finalRemarks = TextEditingController();
  final _workEmail = TextEditingController();
  late Future<Map<String, dynamic>> _detail = _load();
  bool _initialized = false;
  bool _saving = false;
  String _finalStatus = '';

  Future<Map<String, dynamic>> _load() =>
      _api.leadDetail(widget.token, widget.leadId, menu: widget.menu);

  void _initialize(Map<String, dynamic> lead) {
    if (_initialized) return;
    _remarks.text = lead['remarks']?.toString() ?? '';
    _finalRemarks.text = lead['final_remarks']?.toString() ?? '';
    _workEmail.text = lead['work_email']?.toString() ?? '';
    _finalStatus = lead['final_status']?.toString() ?? '';
    _initialized = true;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await _api.updateLead(
        widget.token,
        leadId: widget.leadId,
        remarks: _remarks.text,
        finalStatus: _finalStatus,
        finalRemarks: _finalRemarks.text,
        workEmail: _workEmail.text,
        menu: widget.menu,
      );
      setState(() {
        _initialized = false;
        _detail = _load();
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Lead saved.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _fact(String label, dynamic value) => ListTile(
        dense: true,
        title: Text(label),
        subtitle: Text(value?.toString().trim().isNotEmpty == true
            ? value.toString()
            : '—'),
      );

  @override
  void dispose() {
    _remarks.dispose();
    _finalRemarks.dispose();
    _workEmail.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Candidate profile'),
        actions: [
          IconButton(
            tooltip: 'Update status',
            onPressed: () async {
              await widget.updateStatus();
              if (mounted) {
                setState(() {
                  _initialized = false;
                  _detail = _load();
                });
              }
            },
            icon: const Icon(Icons.edit_note),
          )
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _detail,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final payload = snapshot.data!;
          final lead = payload['lead'] as Map<String, dynamic>;
          _initialize(lead);
          final role = lead['recruitment_roles'] as Map<String, dynamic>?;
          final location =
              lead['recruitment_locations'] as Map<String, dynamic>?;
          final questionnaire = visibleQuestionnaire(
              lead['questionnaire'] as Map<String, dynamic>? ?? {});
          final history = payload['history'] as List<dynamic>? ?? [];
          final messages = payload['messages'] as List<dynamic>? ?? [];
          final sources = payload['sources'] as List<dynamic>? ?? [];
          final documents = payload['documents'] as List<dynamic>? ?? [];
          final finalStatuses = <String>{
            '',
            'Joined',
            'Dropped',
            'Selected',
            'Rejected',
            'Hold',
            if (_finalStatus.isNotEmpty) _finalStatus,
          };
          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(lead['full_name']?.toString() ?? 'Unnamed candidate',
                          style: Theme.of(context).textTheme.titleLarge),
                      Text('${lead['phone'] ?? 'No phone'} • '
                          '${lead['email'] ?? 'No email'}'),
                      const Divider(),
                      _fact(
                          'Status',
                          statusLabel(
                              (lead['status']?.toString().isNotEmpty == true
                                      ? lead['status']
                                      : 'new')
                                  .toString())),
                      _fact('Station',
                          '${location?['code'] ?? 'Unmapped'} — ${location?['name'] ?? ''}'),
                      _fact('Designation',
                          '${role?['code'] ?? 'Unmapped'} — ${role?['name'] ?? ''}'),
                      _fact('Ad', lead['ad_name']),
                      _fact('Attempts',
                          '${lead['total_attempts'] ?? 0} total • ${lead['no_response_attempts'] ?? 0} no response • ${lead['call_back_attempts'] ?? 0} callback'),
                    ],
                  ),
                ),
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: [
                    TextField(
                      controller: _remarks,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Remarks', border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _finalStatus,
                      decoration: const InputDecoration(
                          labelText: 'Final status',
                          border: OutlineInputBorder()),
                      items: finalStatuses
                          .map((status) => DropdownMenuItem(
                              value: status,
                              child: Text(status.isEmpty
                                  ? '— final status —'
                                  : status)))
                          .toList(),
                      onChanged: (value) =>
                          setState(() => _finalStatus = value ?? ''),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _finalRemarks,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Final remarks',
                          border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _workEmail,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                          labelText: 'Work email',
                          hintText: 'firstname.lastname@dropxlogistics.com',
                          border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      child: Text(_saving ? 'Saving…' : 'Save profile'),
                    ),
                  ]),
                ),
              ),
              if (widget.stream == 'hr')
                _HrScreeningCard(
                    token: widget.token,
                    leadId: widget.leadId,
                    initialSummary: lead['remarks']?.toString() ?? '',
                    onSaved: () => setState(() {
                          _initialized = false;
                          _detail = _load();
                        })),
              if (widget.stream == 'workforce' && widget.allowJoining)
                _JoiningCard(
                    token: widget.token,
                    leadId: widget.leadId,
                    lead: lead,
                    history: history,
                    onSaved: () => setState(() {
                          _initialized = false;
                          _detail = _load();
                        })),
              if (widget.stream == 'hr') ...[
                _SectionLabel('Private documents (${documents.length})'),
                if (documents.isEmpty)
                  const Card(
                      child: ListTile(
                          leading: Icon(Icons.folder_open_outlined),
                          title: Text('No documents uploaded.'),
                          subtitle: Text(
                              'Document uploads remain available in the secure HR web workspace.'))),
                ...documents.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  return _fact(item['type'] ?? 'Document',
                      '${item['name'] ?? 'File'} • ${item['createdAt'] ?? ''}');
                }),
              ],
              const _SectionLabel('Application answers'),
              if (questionnaire.isEmpty)
                const Card(
                    child: ListTile(title: Text('No additional answers.'))),
              ...questionnaire.entries.map((entry) =>
                  _fact(entry.key.replaceAll('_', ' '), entry.value)),
              if (history.isNotEmpty ||
                  messages.isNotEmpty ||
                  sources.isNotEmpty)
                Card(
                    child: ExpansionTile(
                  title: const Text('Activity history'),
                  subtitle: const Text('Audit and delivery details'),
                  children: [
                    ...history.map((raw) {
                      final item = raw as Map<String, dynamic>;
                      final remarks = item['remarks']?.toString().trim();
                      final change =
                          '${item['old_value'] ?? '—'} → ${item['new_value'] ?? '—'}';
                      final actor = item['actor_email']?.toString().trim();
                      return _fact(
                          item['event_type'].toString().replaceAll('_', ' '),
                          '${remarks?.isNotEmpty == true ? remarks : change} • ${item['created_at'] ?? ''}${actor?.isNotEmpty == true ? ' • $actor' : ''}');
                    }),
                    ...messages.take(10).map((raw) {
                      final item = raw as Map<String, dynamic>;
                      return _fact(item['template_name'],
                          '${item['status']} • ${item['last_error'] ?? ''}');
                    }),
                  ],
                )),
            ],
          );
        },
      ),
    );
  }
}

class _ReportsPage extends StatelessWidget {
  const _ReportsPage({required this.token, required this.stream});
  final String token;
  final String stream;

  @override
  Widget build(BuildContext context) {
    final api = RecruitmentApi(baseUrl: apiBaseUrl);
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: api.reports(token, stream: stream),
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final summary = snapshot.data!['summary'] as Map<String, dynamic>;
          final funnel = snapshot.data!['funnel'] as List<dynamic>;
          return ListView(padding: const EdgeInsets.all(16), children: [
            GridView.count(
              crossAxisCount: 2,
              childAspectRatio: 1.6,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: <String, String>{
                'total': 'Total leads',
                'contacted': 'Contacted',
                'interviews': 'Interviews',
                'selected': 'Selected',
                'joined': 'Joined',
                'pending24h': '24H+ pending',
                'missingRoute': 'Unmapped',
                'validPhoneRate': 'Valid phones %'
              }
                  .entries
                  .map((entry) => Card(
                          child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(entry.value,
                                  style: const TextStyle(color: Colors.grey)),
                              const Spacer(),
                              Text('${summary[entry.key] ?? 0}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineSmall),
                            ]),
                      )))
                  .toList(),
            ),
            const SizedBox(height: 16),
            Text('Pipeline status',
                style: Theme.of(context).textTheme.titleMedium),
            ...funnel.map((item) {
              final row = item as Map<String, dynamic>;
              return ListTile(
                dense: true,
                title: Text(row['label'].toString().replaceAll('_', ' ')),
                trailing: Text('${row['value']}'),
              );
            }),
          ]);
        },
      ),
    );
  }
}

class _ActiveAdsPage extends StatefulWidget {
  const _ActiveAdsPage(
      {required this.token, required this.stream, required this.user});
  final String token;
  final String stream;
  final Map<String, dynamic> user;

  @override
  State<_ActiveAdsPage> createState() => _ActiveAdsPageState();
}

class _ActiveAdsPageState extends State<_ActiveAdsPage> {
  late Future<Map<String, dynamic>> _ads = _load();

  Future<Map<String, dynamic>> _load() => RecruitmentApi(baseUrl: apiBaseUrl)
      .activeAds(widget.token, stream: widget.stream);

  bool get _canDirectPost {
    if (widget.user['isOwner'] == true) return true;
    final menu = widget.user['menuAccess'];
    if (menu is! Map) return false;
    final workspace = menu[widget.stream];
    return workspace is Map && workspace['Active Ads'] == 'all';
  }

  Future<void> _openPublisher() async {
    try {
      final api = RecruitmentApi(baseUrl: apiBaseUrl);
      final results = await Future.wait([
        api.options(widget.token),
        api.metaAdBuilderCatalog(widget.token, stream: widget.stream),
      ]);
      if (!mounted) return;
      final created = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => _DirectMetaAdPage(
          token: widget.token,
          stream: widget.stream,
          options: results[0],
          catalog: results[1]['catalog'] as Map<String, dynamic>? ?? {},
        ),
      ));
      if (created == true && mounted) setState(() => _ads = _load());
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.stream == 'hr' ? 'HR Job Ads' : 'Workforce Ads'),
        actions: _canDirectPost
            ? [
                IconButton(
                    onPressed: _openPublisher,
                    icon: const Icon(Icons.add_circle_outline),
                    tooltip: 'Create Meta ad')
              ]
            : null,
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _ads,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final ads = snapshot.data!['ads'] as List<dynamic>;
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: ads.length,
            itemBuilder: (context, index) {
              final ad = ads[index] as Map<String, dynamic>;
              return Card(
                  child: ListTile(
                title: Text(ad['ad_name']?.toString() ?? 'Unnamed ad'),
                subtitle: Text(
                    '${ad['route_status'] ?? 'unmapped'} • ₹${ad['daily_budget'] ?? 0}/day'),
                trailing: Text(ad['status']?.toString() ?? 'unknown'),
              ));
            },
          );
        },
      ),
    );
  }
}

class _DirectMetaAdPage extends StatefulWidget {
  const _DirectMetaAdPage(
      {required this.token,
      required this.stream,
      required this.options,
      required this.catalog});
  final String token;
  final String stream;
  final Map<String, dynamic> options;
  final Map<String, dynamic> catalog;

  @override
  State<_DirectMetaAdPage> createState() => _DirectMetaAdPageState();
}

class _DirectMetaAdPageState extends State<_DirectMetaAdPage> {
  String locationId = '';
  String roleId = '';
  String formId = '';
  String campaignMode = 'new';
  String campaignId = '';
  String launchMode = 'paused';
  bool confirmLive = false;
  bool busy = false;
  bool mediaBusy = false;
  Uint8List? posterBytes;
  String posterName = '';
  String imageHash = '';
  String posterUrl = '';
  final budget = TextEditingController(text: '300');
  final days = TextEditingController(text: '7');
  final primary = TextEditingController();
  final headline = TextEditingController();
  final description = TextEditingController();
  final campaignName = TextEditingController();
  final requestId =
      '${DateTime.now().millisecondsSinceEpoch}_${DateTime.now().microsecondsSinceEpoch}';

  List<dynamic> get locations =>
      widget.options['locations'] as List<dynamic>? ?? [];
  List<dynamic> get roles => (widget.options['roles'] as List<dynamic>? ?? [])
      .where((item) => item['stream'] == widget.stream)
      .toList();
  List<dynamic> get forms => (widget.catalog['forms'] as List<dynamic>? ?? [])
      .where((item) => item['status'] == 'ACTIVE')
      .toList();
  List<dynamic> get campaigns =>
      widget.catalog['campaigns'] as List<dynamic>? ?? [];

  @override
  void initState() {
    super.initState();
    if (forms.isNotEmpty) formId = forms.first['id'].toString();
  }

  void _seedCopy() {
    if (locationId.isEmpty || roleId.isEmpty) return;
    final location = locations.firstWhere((item) => item['id'] == locationId);
    final role = roles.firstWhere((item) => item['id'] == roleId);
    final workspace = widget.stream == 'hr' ? 'HR' : 'Workforce';
    campaignName.text = '$workspace Recruitment · ${role['name']}';
    headline.text = '${role['name']} openings at ${location['name']}';
    primary.text =
        'Join DropX Logistics as ${role['name']} at ${location['name']}. Apply now.';
  }

  Future<void> _pickPoster() async {
    try {
      final selected = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 2400,
        imageQuality: 94,
      );
      if (selected == null) return;
      final bytes = await selected.readAsBytes();
      if (bytes.length > 12 * 1024 * 1024) {
        throw Exception('Poster must be 12 MB or smaller.');
      }
      final lower = selected.name.toLowerCase();
      final contentType = lower.endsWith('.png')
          ? 'image/png'
          : lower.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
      if (!mounted) return;
      setState(() {
        mediaBusy = true;
        posterBytes = bytes;
        posterName = selected.name;
        imageHash = '';
        posterUrl = '';
      });
      final result =
          await RecruitmentApi(baseUrl: apiBaseUrl).uploadMetaAdImage(
        widget.token,
        stream: widget.stream,
        bytes: bytes,
        fileName: selected.name,
        contentType: contentType,
      );
      if (!mounted) return;
      setState(() {
        imageHash = result['imageHash']?.toString() ?? '';
        posterUrl = result['previewUrl']?.toString() ?? '';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                'Poster uploaded. Feed keeps the full artwork; Story/Reels shows the 9:16 auto-fill preview.')),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          imageHash = '';
          posterUrl = '';
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => mediaBusy = false);
    }
  }

  Widget _placementCard(String platform, String placement,
      {required bool story}) {
    final bytes = posterBytes;
    if (bytes == null) return const SizedBox.shrink();
    return Container(
      width: story ? 138 : 184,
      margin: const EdgeInsets.only(right: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: dropxBorder),
        borderRadius: BorderRadius.circular(13),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(children: [
            CircleAvatar(
                radius: 10,
                backgroundColor: platform == 'Instagram'
                    ? dropxPink
                    : const Color(0xff1877f2),
                child: Text(platform.substring(0, 1),
                    style: const TextStyle(color: Colors.white, fontSize: 9))),
            const SizedBox(width: 6),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  const Text('DropX Logistics',
                      style:
                          TextStyle(fontWeight: FontWeight.w800, fontSize: 9)),
                  Text(placement,
                      style: const TextStyle(color: Colors.grey, fontSize: 7))
                ])),
          ]),
        ),
        Expanded(
            child: story
                ? Stack(fit: StackFit.expand, children: [
                    Opacity(
                        opacity: .45,
                        child: Image.memory(bytes,
                            fit: BoxFit.cover, alignment: Alignment.center)),
                    ColoredBox(color: Colors.black.withOpacity(.22)),
                    Padding(
                        padding: const EdgeInsets.fromLTRB(0, 28, 0, 38),
                        child: Image.memory(bytes, fit: BoxFit.contain)),
                    const Positioned(
                        left: 20,
                        right: 20,
                        bottom: 12,
                        child: DecoratedBox(
                            decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius:
                                    BorderRadius.all(Radius.circular(20))),
                            child: Padding(
                                padding: EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 5),
                                child: Text('Apply now ↑',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                        color: dropxInk,
                                        fontSize: 8,
                                        fontWeight: FontWeight.w800)))))
                  ])
                : ColoredBox(
                    color: const Color(0xffeef1f5),
                    child: Image.memory(bytes, fit: BoxFit.contain))),
        if (!story)
          Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        headline.text.isEmpty ? 'Your headline' : headline.text,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 9, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 3),
                    const Text('Apply now',
                        style: TextStyle(
                            color: dropxPink,
                            fontSize: 8,
                            fontWeight: FontWeight.w700))
                  ])),
      ]),
    );
  }

  Widget _placementPreviews() =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Placement preview',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 3),
        const Text(
            'Feed keeps the full poster. Story/Reels estimates Meta auto-fill without cropping the artwork.',
            style: TextStyle(color: Colors.grey, fontSize: 11)),
        const SizedBox(height: 10),
        SizedBox(
            height: 278,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              _placementCard('Instagram', 'Feed · original', story: false),
              _placementCard('Instagram', 'Story / Reels · 9:16 auto-fill',
                  story: true),
              _placementCard('Facebook', 'Feed · original', story: false),
              _placementCard('Facebook', 'Story · 9:16 auto-fill', story: true),
            ])),
      ]);

  String _generatedAdName() {
    if (locationId.isEmpty || roleId.isEmpty) {
      return 'Select station and designation';
    }
    final location = locations.firstWhere((item) => item['id'] == locationId);
    final role = roles.firstWhere((item) => item['id'] == roleId);
    final date =
        DateTime.now().toIso8601String().substring(0, 10).replaceAll('-', '');
    return '${location['code'].toString().toUpperCase()}_${role['code'].toString().toUpperCase()}_$date';
  }

  Map<String, dynamic> _draft() {
    final location = locations.firstWhere((item) => item['id'] == locationId);
    final role = roles.firstWhere((item) => item['id'] == roleId);
    final date =
        DateTime.now().toIso8601String().substring(0, 10).replaceAll('-', '');
    final code = '${location['code']}_${role['code']}';
    return {
      'campaignMode': campaignMode,
      'campaignId': campaignId.isEmpty ? null : campaignId,
      'campaignName': campaignName.text,
      'formId': formId,
      'dailyBudget': double.tryParse(budget.text) ?? 0,
      'daysRequired': int.tryParse(days.text) ?? 0,
      'adName': _generatedAdName(),
      'adSetName': '${code}_India',
      'creativeName': '${code}_Creative_$date',
      'primaryText': primary.text,
      'headline': headline.text,
      'description': description.text,
      'imageHash': imageHash,
      'posterUrl': posterUrl.isEmpty ? null : posterUrl,
      'destinationUrl': 'https://recruit.dropxlogistics.com',
      'callToAction': 'APPLY_NOW',
    };
  }

  Future<void> _review() async {
    setState(() => busy = true);
    try {
      final api = RecruitmentApi(baseUrl: apiBaseUrl);
      final checked = await api.publishMetaAd(widget.token,
          stream: widget.stream,
          locationId: locationId,
          roleId: roleId,
          clientRequestId: requestId,
          draft: _draft(),
          launchMode: launchMode,
          confirmLive: confirmLive,
          validateOnly: true);
      if (!mounted) return;
      final review = checked['review'] as Map<String, dynamic>;
      final confirmed = await showDialog<bool>(
          context: context,
          builder: (_) => AlertDialog(
                title: const Text('Final review'),
                content: SingleChildScrollView(
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(
                          '${review['station']}\n${review['designation']}\n\n₹${review['dailyBudget']}/day × ${review['durationDays']} days\n${launchMode == 'live' ? 'Launch live' : 'Create paused'}'),
                      if (posterBytes != null) ...[
                        const SizedBox(height: 14),
                        ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 280),
                            child: ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: ColoredBox(
                                    color: const Color(0xffeef1f5),
                                    child: Image.memory(posterBytes!,
                                        fit: BoxFit.contain))))
                      ],
                    ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Back')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: Text(launchMode == 'live' ? 'Launch' : 'Create'))
                ],
              ));
      if (confirmed != true) return;
      await api.publishMetaAd(widget.token,
          stream: widget.stream,
          locationId: locationId,
          roleId: roleId,
          clientRequestId: requestId,
          draft: _draft(),
          launchMode: launchMode,
          confirmLive: confirmLive);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(launchMode == 'live'
              ? 'Meta ad launched.'
              : 'Meta ad created paused.')));
      Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: Text(widget.stream == 'hr'
                ? 'Create HR Meta Ad'
                : 'Create Workforce Meta Ad')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Text('Build and launch without leaving DropX',
              style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
              value: locationId.isEmpty ? null : locationId,
              decoration: const InputDecoration(labelText: 'Station'),
              items: locations
                  .map((item) => DropdownMenuItem<String>(
                      value: item['id'].toString(),
                      child: Text('${item['code']} — ${item['name']}')))
                  .toList(),
              onChanged: (value) {
                setState(() => locationId = value ?? '');
                _seedCopy();
              }),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              value: roleId.isEmpty ? null : roleId,
              decoration: const InputDecoration(labelText: 'Designation'),
              items: roles
                  .map((item) => DropdownMenuItem<String>(
                      value: item['id'].toString(),
                      child: Text('${item['code']} — ${item['name']}')))
                  .toList(),
              onChanged: (value) {
                setState(() => roleId = value ?? '');
                _seedCopy();
              }),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
                child: TextField(
                    controller: budget,
                    keyboardType: TextInputType.number,
                    decoration:
                        const InputDecoration(labelText: 'Daily budget ₹'))),
            const SizedBox(width: 12),
            Expanded(
                child: TextField(
                    controller: days,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Days')))
          ]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              value: formId.isEmpty ? null : formId,
              decoration: const InputDecoration(labelText: 'Meta instant form'),
              items: forms
                  .map((item) => DropdownMenuItem<String>(
                      value: item['id'].toString(),
                      child: Text(item['name'].toString())))
                  .toList(),
              onChanged: (value) => setState(() => formId = value ?? '')),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              value: campaignMode,
              decoration: const InputDecoration(labelText: 'Campaign'),
              items: const [
                DropdownMenuItem(
                    value: 'new',
                    child: Text('Create new Employment campaign')),
                DropdownMenuItem(
                    value: 'existing', child: Text('Use existing campaign'))
              ],
              onChanged: (value) =>
                  setState(() => campaignMode = value ?? 'new')),
          if (campaignMode == 'existing') ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
                value: campaignId.isEmpty ? null : campaignId,
                decoration:
                    const InputDecoration(labelText: 'Existing campaign'),
                items: campaigns
                    .map((item) => DropdownMenuItem<String>(
                        value: item['id'].toString(),
                        child: Text(item['name'].toString())))
                    .toList(),
                onChanged: (value) => setState(() => campaignId = value ?? ''))
          ] else ...[
            const SizedBox(height: 12),
            TextField(
                controller: campaignName,
                decoration: const InputDecoration(labelText: 'Campaign name'))
          ],
          const SizedBox(height: 12),
          InputDecorator(
              decoration: const InputDecoration(
                  labelText: 'Ad name (Meta)',
                  helperText: 'Convention: STATION_DESIGNATION_YYYYMMDD'),
              child: Text(_generatedAdName(),
                  style: const TextStyle(fontWeight: FontWeight.w800))),
          const SizedBox(height: 12),
          OutlinedButton.icon(
              onPressed: mediaBusy ? null : _pickPoster,
              icon: Icon(posterBytes == null
                  ? Icons.upload_file
                  : Icons.image_outlined),
              label: Text(mediaBusy
                  ? 'Uploading poster…'
                  : posterBytes == null
                      ? 'Upload poster'
                      : 'Replace poster · $posterName')),
          if (posterBytes != null) ...[
            const SizedBox(height: 12),
            _placementPreviews()
          ],
          const SizedBox(height: 12),
          TextField(
              controller: headline,
              decoration: const InputDecoration(labelText: 'Headline')),
          const SizedBox(height: 12),
          TextField(
              controller: primary,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Primary text')),
          const SizedBox(height: 12),
          TextField(
              controller: description,
              decoration:
                  const InputDecoration(labelText: 'Description (optional)')),
          const SizedBox(height: 12),
          SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                    value: 'paused',
                    label: Text('Create paused'),
                    icon: Icon(Icons.pause_circle_outline)),
                ButtonSegment(
                    value: 'live',
                    label: Text('Launch live'),
                    icon: Icon(Icons.rocket_launch_outlined))
              ],
              selected: {
                launchMode
              },
              onSelectionChanged: (value) =>
                  setState(() => launchMode = value.first)),
          if (launchMode == 'live')
            CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: confirmLive,
                title: const Text(
                    'I confirm the budget and want this ad to start immediately.'),
                onChanged: (value) =>
                    setState(() => confirmLive = value == true)),
          const SizedBox(height: 18),
          FilledButton.icon(
              onPressed: busy ||
                      mediaBusy ||
                      imageHash.isEmpty ||
                      locationId.isEmpty ||
                      roleId.isEmpty ||
                      formId.isEmpty ||
                      (launchMode == 'live' && !confirmLive)
                  ? null
                  : _review,
              icon: const Icon(Icons.fact_check_outlined),
              label: Text(mediaBusy
                  ? 'Uploading…'
                  : busy
                      ? 'Checking…'
                      : 'Review ad')),
        ]),
      );
}

class _ModulePage extends StatefulWidget {
  const _ModulePage({
    required this.token,
    required this.title,
    required this.module,
    this.stream,
  });
  final String token;
  final String title;
  final String module;
  final String? stream;

  @override
  State<_ModulePage> createState() => _ModulePageState();
}

class _ModulePageState extends State<_ModulePage> {
  final _api = RecruitmentApi(baseUrl: apiBaseUrl);
  late Future<Map<String, dynamic>> _data = _load();

  Future<Map<String, dynamic>> _load() =>
      _api.module(widget.token, widget.module, stream: widget.stream);
  void _reload() => setState(() => _data = _load());

  String _date(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null ? '—' : parsed.toLocal().toString().substring(0, 16);
  }

  Widget _row({
    required String title,
    required String subtitle,
    String? trailing,
    Widget? action,
  }) =>
      Card(
          child: ListTile(
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: action ?? (trailing == null ? null : Text(trailing)),
      ));

  Future<void> _reviewRequest(Map<String, dynamic> item, String action) async {
    final publishNew = action == 'publish' && item['request_type'] == 'new_ad';
    if (publishNew) {
      try {
        final payload = await _api.metaAdBuilderCatalog(widget.token);
        if (!mounted) return;
        final result = await showDialog<Map<String, dynamic>>(
          context: context,
          builder: (_) => _MetaPublishDialog(
            request: item,
            catalog: payload['catalog'] as Map<String, dynamic>? ?? {},
          ),
        );
        if (result == null) return;
        await _api.updateAdRequest(
          widget.token,
          id: item['id'].toString(),
          action: action,
          remarks: result['remarks']?.toString(),
          publishMode: 'api',
          metaDraft: result['metaDraft'] as Map<String, dynamic>,
        );
        _reload();
      } catch (error) {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
      return;
    }
    final remarks = TextEditingController();
    final metaAdId = TextEditingController();
    final publishedUrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_requestActionLabel(action)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: remarks,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: action == 'reject' ? 'Rejection reason' : 'Remarks',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Continue')),
        ],
      ),
    );
    if (confirmed != true) {
      remarks.dispose();
      metaAdId.dispose();
      publishedUrl.dispose();
      return;
    }
    try {
      await _api.updateAdRequest(
        widget.token,
        id: item['id'].toString(),
        action: action,
        remarks: remarks.text.trim(),
        metaAdId: metaAdId.text.trim(),
        publishedUrl: publishedUrl.text.trim(),
      );
      _reload();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      remarks.dispose();
      metaAdId.dispose();
      publishedUrl.dispose();
    }
  }

  String _requestActionLabel(String action) {
    const labels = {
      'review': 'Start Review',
      'approve': 'Approve',
      'reject': 'Reject',
      'publish': 'Mark Published',
      'complete': 'Complete',
      'cancel': 'Cancel Request',
    };
    return labels[action] ?? action;
  }

  List<Widget> _content(Map<String, dynamic> data) {
    switch (widget.module) {
      case 'masters':
        final locations = (data['locations'] as List<dynamic>? ?? []);
        final roles = (data['roles'] as List<dynamic>? ?? []);
        return [
          const _SectionLabel('Locations & station contacts'),
          ...locations.map((raw) {
            final item = raw as Map<String, dynamic>;
            final contact = item['contact'] as Map<String, dynamic>?;
            return _row(
              title: '${item['code']} — ${item['name']}',
              subtitle:
                  '${item['cluster'] ?? 'No cluster'} • ${contact?['poc_name'] ?? item['poc_name'] ?? 'No POC'} • ${contact?['poc_mobile'] ?? item['poc_mobile'] ?? 'No mobile'}',
              trailing: item['is_active'] == true ? 'Active' : 'Inactive',
            );
          }),
          const _SectionLabel('Designations'),
          ...roles.map((raw) {
            final item = raw as Map<String, dynamic>;
            return _row(
              title: '${item['code']} — ${item['name']}',
              subtitle: item['stream'] == 'hr'
                  ? 'HR • white-collar'
                  : 'Workforce • blue-collar',
              trailing: item['is_active'] == true ? 'Active' : 'Inactive',
            );
          }),
        ];
      case 'access':
        final users = (data['allowlist'] as List<dynamic>? ?? []);
        return [
          _SectionLabel('${users.length} approved identities'),
          ...users.map((raw) {
            final item = raw as Map<String, dynamic>;
            return _row(
              title:
                  item['display_name']?.toString() ?? item['email'].toString(),
              subtitle: '${item['email']} • ${item['access_template']}',
              trailing: item['is_active'] == true ? 'Active' : 'Inactive',
            );
          }),
        ];
      case 'ad-requests':
        final requests = (data['requests'] as List<dynamic>? ?? []);
        final permissions = (data['permissions'] as List<dynamic>? ?? [])
            .map((item) => item.toString())
            .toSet();
        return [
          _SectionLabel('${requests.length} advertising requests'),
          if (permissions.contains('create'))
            Card(
              child: ListTile(
                leading: const Icon(Icons.add_task_outlined),
                title: const Text('Request new advertisement'),
                subtitle:
                    const Text('Submit for configured review and publishing'),
                trailing: const Icon(Icons.chevron_right),
                onTap: _openAdRequestForm,
              ),
            ),
          ...requests.map((raw) {
            final item = raw as Map<String, dynamic>;
            final status = item['status']?.toString() ?? 'requested';
            final allowedActions =
                (item['allowedActions'] as List<dynamic>? ?? [])
                    .map((value) => value.toString())
                    .toList();
            final action = allowedActions.isNotEmpty
                ? PopupMenuButton<String>(
                    onSelected: (value) => _reviewRequest(item, value),
                    itemBuilder: (_) => allowedActions
                        .map((value) => PopupMenuItem(
                              value: value,
                              child: Text(_requestActionLabel(value)),
                            ))
                        .toList(),
                  )
                : null;
            return _row(
              title:
                  '${item['request_id']} • ${item['request_type'].toString().replaceAll('_', ' ')}',
              subtitle:
                  '${item['recruitment_locations']?['code'] ?? '—'} / ${item['recruitment_roles']?['code'] ?? item['recruitment_ads']?['ad_name'] ?? '—'}\n${item['requested_by_display'] ?? 'Unknown requester'} • ${_date(item['requested_at'])}',
              trailing: status,
              action: action,
            );
          }),
          if (!permissions.contains('create') && requests.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                  'No advertising requests are visible in your assigned scope.'),
            ),
        ];
      case 'connections':
        final connections = (data['connections'] as List<dynamic>? ?? []);
        return [
          const _SectionLabel('Connection state (credentials remain hidden)'),
          ...connections.map((raw) {
            final item = raw as Map<String, dynamic>;
            return _row(
              title: item['provider'].toString().toUpperCase(),
              subtitle:
                  '${item['connectionStatus']?.toString().replaceAll('_', ' ') ?? 'not tested'} • last test ${_date(item['lastTestedAt'])}',
              trailing: item['isEnabled'] == true ? 'Enabled' : 'Disabled',
            );
          }),
        ];
      case 'system-health':
        final leads = data['leads'] as Map<String, dynamic>? ?? {};
        final whatsapp = data['whatsapp'] as Map<String, dynamic>? ?? {};
        return [
          const _SectionLabel('Production data'),
          _row(
              title: '${leads['active'] ?? 0}',
              subtitle: 'Active unique leads'),
          _row(title: '${leads['archived'] ?? 0}', subtitle: 'Archived leads'),
          _row(
              title: '${leads['sourceEvents'] ?? 0}',
              subtitle: 'Source occurrences'),
          _row(
              title: '${leads['unmapped'] ?? 0}',
              subtitle: 'Leads needing mapping'),
          const _SectionLabel('WhatsApp queue'),
          _row(
              title:
                  '${whatsapp['queued'] ?? 0} queued • ${whatsapp['retry'] ?? 0} retry',
              subtitle:
                  '${whatsapp['sent'] ?? 0} sent • ${whatsapp['failed'] ?? 0} failed'),
        ];
      case 'audit':
        final events = (data['events'] as List<dynamic>? ?? []);
        return [
          _SectionLabel('Latest ${events.length} audited changes'),
          ...events.map((raw) {
            final item = raw as Map<String, dynamic>;
            final lead = item['recruitment_leads'] as Map<String, dynamic>?;
            return _row(
              title:
                  lead?['full_name']?.toString() ?? item['lead_id'].toString(),
              subtitle:
                  '${item['event_type'].toString().replaceAll('_', ' ')} • ${item['old_value'] ?? '—'} → ${item['new_value'] ?? '—'}\n${_date(item['created_at'])}',
              trailing: item['actor_email']?.toString() ?? 'System',
            );
          }),
        ];
      default:
        return const [Center(child: Text('No module renderer is available.'))];
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(onPressed: _reload, icon: const Icon(Icons.refresh))
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _data,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          return ListView(
            padding: const EdgeInsets.all(12),
            children: _content(snapshot.data!),
          );
        },
      ),
    );
  }

  Future<void> _openAdRequestForm() async {
    try {
      final options = await _api.options(widget.token);
      if (!mounted) return;
      final created = await showDialog<bool>(
        context: context,
        builder: (_) => _AdRequestDialog(
          token: widget.token,
          api: _api,
          locations: options['locations'] as List<dynamic>? ?? [],
          roles: (options['roles'] as List<dynamic>? ?? [])
              .where((raw) =>
                  (raw as Map<String, dynamic>)['stream'] == widget.stream)
              .toList(),
        ),
      );
      if (created == true) _reload();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }
}

class _MetaPublishDialog extends StatefulWidget {
  const _MetaPublishDialog({required this.request, required this.catalog});
  final Map<String, dynamic> request;
  final Map<String, dynamic> catalog;

  @override
  State<_MetaPublishDialog> createState() => _MetaPublishDialogState();
}

class _MetaPublishDialogState extends State<_MetaPublishDialog> {
  late final TextEditingController _campaign;
  late final TextEditingController _primary;
  late final TextEditingController _headline;
  late final TextEditingController _description;
  late final TextEditingController _poster;
  late final TextEditingController _destination;
  late final TextEditingController _adName;
  late final TextEditingController _adSetName;
  late final TextEditingController _creativeName;
  final _remarks = TextEditingController();
  String _campaignMode = 'new';
  String? _campaignId;
  String? _formId;
  String _callToAction = 'APPLY_NOW';
  String? _error;

  Map<String, dynamic> _relation(String key) {
    final value = widget.request[key];
    if (value is Map<String, dynamic>) return value;
    if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      return value.first as Map<String, dynamic>;
    }
    return {};
  }

  @override
  void initState() {
    super.initState();
    final location = _relation('recruitment_locations');
    final role = _relation('recruitment_roles');
    final code = '${location['code'] ?? 'STATION'}_${role['code'] ?? 'ROLE'}';
    final date = DateTime.now();
    final dateCode =
        '${date.year}${date.month.toString().padLeft(2, '0')}${date.day.toString().padLeft(2, '0')}';
    final forms = widget.catalog['forms'] as List<dynamic>? ?? [];
    _formId = forms.isEmpty
        ? null
        : (forms.first as Map<String, dynamic>)['id']?.toString();
    _campaign = TextEditingController(text: '$code Recruitment');
    _primary = TextEditingController(
      text:
          'Join DropX Logistics as ${role['name'] ?? role['code'] ?? 'a team member'} at ${location['name'] ?? location['code'] ?? 'your preferred location'}. Apply now.',
    );
    _headline = TextEditingController(
      text:
          '${role['name'] ?? 'Job'} openings at ${location['name'] ?? location['code'] ?? 'DropX'}',
    );
    _description = TextEditingController(
      text: [
        widget.request['payment_offer'],
        widget.request['location_details']
      ]
          .where((value) => value != null && value.toString().trim().isNotEmpty)
          .join(' · '),
    );
    _poster = TextEditingController(
        text: widget.request['poster_url']?.toString() ?? '');
    _destination =
        TextEditingController(text: 'https://recruit.dropxlogistics.com');
    _adName = TextEditingController(text: '${code}_$dateCode');
    _adSetName = TextEditingController(text: '${code}_India');
    _creativeName = TextEditingController(text: '${code}_Creative_$dateCode');
  }

  void _submit() {
    if (_formId == null || _formId!.isEmpty) {
      setState(() => _error = 'Choose a Meta instant form.');
      return;
    }
    if (_campaignMode == 'new' && _campaign.text.trim().isEmpty) {
      setState(() => _error = 'Enter the campaign name.');
      return;
    }
    if (_campaignMode == 'existing' &&
        (_campaignId == null || _campaignId!.isEmpty)) {
      setState(() => _error = 'Choose an employment lead campaign.');
      return;
    }
    if (_primary.text.trim().isEmpty ||
        _headline.text.trim().isEmpty ||
        _poster.text.trim().isEmpty ||
        _destination.text.trim().isEmpty) {
      setState(() => _error =
          'Primary text, headline, poster and destination are required.');
      return;
    }
    Navigator.pop(context, {
      'remarks': _remarks.text.trim(),
      'metaDraft': {
        'campaignMode': _campaignMode,
        'campaignId': _campaignId,
        'campaignName': _campaign.text.trim(),
        'formId': _formId,
        'dailyBudget': widget.request['requested_budget'],
        'daysRequired': widget.request['days_required'] ?? 7,
        'adName': _adName.text.trim(),
        'adSetName': _adSetName.text.trim(),
        'creativeName': _creativeName.text.trim(),
        'primaryText': _primary.text.trim(),
        'headline': _headline.text.trim(),
        'description': _description.text.trim(),
        'posterUrl': _poster.text.trim(),
        'destinationUrl': _destination.text.trim(),
        'callToAction': _callToAction,
      }
    });
  }

  @override
  void dispose() {
    for (final controller in [
      _campaign,
      _primary,
      _headline,
      _description,
      _poster,
      _destination,
      _adName,
      _adSetName,
      _creativeName,
      _remarks
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final forms = widget.catalog['forms'] as List<dynamic>? ?? [];
    final campaigns = widget.catalog['campaigns'] as List<dynamic>? ?? [];
    final budget = widget.request['requested_budget'] ?? 0;
    final days = widget.request['days_required'] ?? 0;
    return AlertDialog(
      insetPadding: const EdgeInsets.all(12),
      title: const Text('Create Meta recruitment ad'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: const Color(0xffeaf8f1),
                  borderRadius: BorderRadius.circular(10)),
              child: Text(
                  'Employment · India · ₹$budget/day · $days days · created paused',
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, color: Color(0xff087443))),
            ),
            const SizedBox(height: 12),
            Text(
                '${widget.catalog['accountName'] ?? 'Meta account'} · ${widget.catalog['pageName'] ?? 'Page'}'),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _campaignMode,
              decoration: const InputDecoration(
                  labelText: 'Campaign setup', border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(
                    value: 'new', child: Text('Create new campaign')),
                DropdownMenuItem(
                    value: 'existing', child: Text('Use existing campaign')),
              ],
              onChanged: (value) =>
                  setState(() => _campaignMode = value ?? 'new'),
            ),
            const SizedBox(height: 10),
            if (_campaignMode == 'new')
              TextField(
                  controller: _campaign,
                  decoration: const InputDecoration(
                      labelText: 'Campaign name', border: OutlineInputBorder()))
            else
              DropdownButtonFormField<String>(
                value: _campaignId,
                isExpanded: true,
                decoration: const InputDecoration(
                    labelText: 'Employment lead campaign',
                    border: OutlineInputBorder()),
                items: campaigns.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  return DropdownMenuItem(
                      value: item['id'].toString(),
                      child: Text(item['name']?.toString() ?? 'Campaign'));
                }).toList(),
                onChanged: (value) => setState(() {
                  _campaignId = value;
                  final match = campaigns
                      .cast<Map<String, dynamic>>()
                      .where((item) => item['id']?.toString() == value);
                  if (match.isNotEmpty) {
                    _campaign.text = match.first['name']?.toString() ?? '';
                  }
                }),
              ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _formId,
              isExpanded: true,
              decoration: const InputDecoration(
                  labelText: 'Instant lead form', border: OutlineInputBorder()),
              items: forms.map((raw) {
                final item = raw as Map<String, dynamic>;
                return DropdownMenuItem(
                    value: item['id'].toString(),
                    child: Text(item['name']?.toString() ?? 'Form'));
              }).toList(),
              onChanged: (value) => setState(() => _formId = value),
            ),
            const SizedBox(height: 10),
            TextField(
                controller: _primary,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                    labelText: 'Primary text', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(
                controller: _headline,
                decoration: const InputDecoration(
                    labelText: 'Headline', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(
                controller: _description,
                decoration: const InputDecoration(
                    labelText: 'Description', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(
                controller: _poster,
                decoration: const InputDecoration(
                    labelText: 'Poster HTTPS link',
                    border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(
                controller: _destination,
                decoration: const InputDecoration(
                    labelText: 'Destination link',
                    border: OutlineInputBorder())),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _callToAction,
              decoration: const InputDecoration(
                  labelText: 'Call to action', border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: 'APPLY_NOW', child: Text('Apply Now')),
                DropdownMenuItem(value: 'SIGN_UP', child: Text('Sign Up')),
                DropdownMenuItem(
                    value: 'LEARN_MORE', child: Text('Learn More')),
              ],
              onChanged: (value) =>
                  setState(() => _callToAction = value ?? 'APPLY_NOW'),
            ),
            const SizedBox(height: 10),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text('Names and audit note'),
              children: [
                TextField(
                    controller: _adName,
                    decoration: const InputDecoration(
                        labelText: 'Ad name', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: _adSetName,
                    decoration: const InputDecoration(
                        labelText: 'Ad set name',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: _creativeName,
                    decoration: const InputDecoration(
                        labelText: 'Creative name',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: _remarks,
                    maxLines: 2,
                    decoration: const InputDecoration(
                        labelText: 'Publish note',
                        border: OutlineInputBorder())),
              ],
            ),
            if (_error != null)
              Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child:
                      Text(_error!, style: const TextStyle(color: Colors.red))),
          ]),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel')),
        FilledButton(onPressed: _submit, child: const Text('Create paused ad')),
      ],
    );
  }
}

class _AdRequestDialog extends StatefulWidget {
  const _AdRequestDialog({
    required this.token,
    required this.api,
    required this.locations,
    required this.roles,
  });
  final String token;
  final RecruitmentApi api;
  final List<dynamic> locations;
  final List<dynamic> roles;

  @override
  State<_AdRequestDialog> createState() => _AdRequestDialogState();
}

class _AdRequestDialogState extends State<_AdRequestDialog> {
  final _budget = TextEditingController();
  final _days = TextEditingController();
  final _poster = TextEditingController();
  final _offer = TextEditingController();
  final _details = TextEditingController();
  final _notes = TextEditingController();
  String? _locationId;
  String? _roleId;
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    if (_locationId == null || _roleId == null) {
      setState(() => _error = 'Select both station and designation.');
      return;
    }
    if ((double.tryParse(_budget.text) ?? 0) < 100 ||
        (int.tryParse(_days.text) ?? 0) < 1 ||
        !_poster.text.trim().startsWith('https://')) {
      setState(() => _error =
          'Enter budget of at least ₹100, duration, and an HTTPS poster link.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.createAdRequest(
        widget.token,
        locationId: _locationId!,
        roleId: _roleId!,
        requestedBudget: double.tryParse(_budget.text),
        daysRequired: int.tryParse(_days.text),
        posterUrl: _poster.text.trim(),
        paymentOffer: _offer.text.trim(),
        locationDetails: _details.text.trim(),
        notes: _notes.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _budget.dispose();
    _days.dispose();
    _poster.dispose();
    _offer.dispose();
    _details.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New ad request'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: _locationId,
                isExpanded: true,
                decoration: const InputDecoration(
                    labelText: 'Station', border: OutlineInputBorder()),
                items: widget.locations.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  return DropdownMenuItem(
                    value: item['id'].toString(),
                    child: Text('${item['code']} — ${item['name']}'),
                  );
                }).toList(),
                onChanged: (value) => setState(() => _locationId = value),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _roleId,
                isExpanded: true,
                decoration: const InputDecoration(
                    labelText: 'Designation', border: OutlineInputBorder()),
                items: widget.roles.map((raw) {
                  final item = raw as Map<String, dynamic>;
                  return DropdownMenuItem(
                    value: item['id'].toString(),
                    child: Text('${item['code']} — ${item['name']}'),
                  );
                }).toList(),
                onChanged: (value) => setState(() => _roleId = value),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _budget,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'Daily budget', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _days,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'Days required', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _poster,
                decoration: const InputDecoration(
                    labelText: 'Poster HTTPS link',
                    border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _offer,
                decoration: const InputDecoration(
                    labelText: 'Payment offer', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _details,
                maxLines: 2,
                decoration: const InputDecoration(
                    labelText: 'Location details',
                    border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _notes,
                maxLines: 3,
                decoration: const InputDecoration(
                    labelText: 'Notes', border: OutlineInputBorder()),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child:
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: _saving ? null : () => Navigator.pop(context),
            child: const Text('Cancel')),
        FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Submitting…' : 'Submit request')),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(8, 18, 8, 8),
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      );
}

class _RestoredSession {
  const _RestoredSession(this.token, this.user);
  final String token;
  final Map<String, dynamic> user;
}

class _LeadUpdateDecision {
  const _LeadUpdateDecision({
    required this.status,
    required this.remarks,
    required this.retry,
    required this.actionAt,
  });
  final String status;
  final String remarks;
  final bool retry;
  final DateTime? actionAt;
}

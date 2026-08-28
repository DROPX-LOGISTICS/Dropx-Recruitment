// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dropx_recruitment/main.dart';

void main() {
  test('nearest assigned station is selected from current GPS', () {
    final nearest = nearestAssignedLocation([
      {
        'id': 'koza',
        'code': 'KOZA',
        'name': 'Kozhikode',
        'latitude': 11.2588,
        'longitude': 75.7804
      },
      {
        'id': 'erse',
        'code': 'ERSE',
        'name': 'Perumbavoor',
        'latitude': 10.1069,
        'longitude': 76.4737
      },
    ], 11.26, 75.78);
    expect(nearest?['id'], 'koza');
    expect(nearest?['distanceMeters'], lessThan(500));
  });

  testWidgets('mobile login renders both authentication methods',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: RecruitmentLoginPage()));
    await tester.pump();

    expect(find.text('Send WhatsApp OTP'), findsOneWidget);
    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('workforce-only user sees the operational workspace',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: RecruitmentHomePage(
        token: 'test-token',
        user: {
          'name': 'Recruiter',
          'workforce': true,
          'hr': false,
          'manageMasters': false,
          'manageAds': false,
          'manageUsers': false,
          'accessTemplate': 'Workforce recruiter',
        },
      ),
    ));
    await tester.pump();

    await tester.scrollUntilVisible(find.text('Calling queue'), 220);
    expect(find.text('Calling queue'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('No response / Call back'), 220);
    expect(find.text('No response / Call back'), findsOneWidget);
    expect(find.text('Candidates'), findsNothing);
  });

  testWidgets('HR-only user sees the candidate lifecycle workspace',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: RecruitmentHomePage(
        token: 'test-token',
        user: {
          'name': 'HR',
          'workforce': false,
          'hr': true,
          'manageMasters': false,
          'manageAds': false,
          'manageUsers': false,
          'accessTemplate': 'HR recruiter',
        },
      ),
    ));
    await tester.pump();

    expect(find.text('Candidates'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Selection & offers'), 220);
    expect(find.text('Selection & offers'), findsOneWidget);
    expect(find.text('Calling queue'), findsNothing);
  });

  testWidgets('mobile permission alone exposes recruiter performance',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: RecruitmentHomePage(
        token: 'test-token',
        user: {
          'name': 'Recruiter',
          'workforce': true,
          'hr': false,
          'manageMasters': false,
          'manageAds': false,
          'manageUsers': false,
          'recruitmentFunction': 'viewer',
          'mobileMenuPermissions': ['Recruiter Performance'],
        },
      ),
    ));
    await tester.pump();

    expect(find.text('Telecaller Performance'), findsOneWidget);
  });

  testWidgets('field recruiter receives a field-specific mission workspace',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: RecruitmentHomePage(
        token: 'test-token',
        user: {
          'name': 'Anees PP',
          'workforce': true,
          'hr': false,
          'recruitmentFunction': 'field_recruiter',
          'designationCode': 'FREC',
          'mobileMenuPermissions': ['Field Recruitment', 'Workforce Plan'],
        },
      ),
    ));
    await tester.pump();

    expect(find.text('Build today’s local hiring pipeline'), findsOneWidget);
    expect(find.text('Your assigned-station hiring picture'), findsOneWidget);
    expect(find.text('Start My Field Mission'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('My Workforce Plan'), 220);
    expect(find.text('My Workforce Plan'), findsOneWidget);
    expect(find.text('Field Recruiter Performance'), findsOneWidget);
    expect(find.text('Calling queue'), findsNothing);
    expect(find.textContaining('Call faster'), findsNothing);
  });

  testWidgets(
      'recruitment influencer receives only referral and milestone workspace',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: RecruitmentHomePage(
        token: 'test-token',
        user: {
          'name': 'Local Partner',
          'workforce': true,
          'hr': false,
          'recruitmentFunction': 'influencer',
          'designationCode': 'RINF',
          // A deliberately over-broad list proves the function boundary wins.
          'mobileMenuPermissions': [
            'All Leads',
            'Recruiter Performance',
            'Field Recruitment',
            'Field Executive Onboarding',
            'Influencer Performance',
          ],
        },
      ),
    ));
    await tester.pump();

    expect(
        find.text('Turn local connections into real careers'), findsOneWidget);
    expect(find.text('Refer an Associate'), findsOneWidget);
    expect(find.text('My Referrals & Milestones'), findsOneWidget);
    expect(find.text('Calling queue'), findsNothing);
    expect(find.text('Telecaller Performance'), findsNothing);
    expect(find.text('Start My Field Mission'), findsNothing);
    expect(find.text('Manual Punch Approvals'), findsNothing);
  });
}

import 'dart:io';
import 'package:dropx_recruitment/gps_point_queue.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> point(String id, int second) => {
      'clientPointId': id,
      'recordedAt':
          '2026-08-05T09:00:${second.toString().padLeft(2, '0')}.000Z',
      'latitude': 11.566 + second / 10000,
      'longitude': 75.724,
      'accuracy': 10,
    };

void main() {
  late Directory directory;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('dropx-gps-queue-');
  });

  tearDown(() async {
    if (await directory.exists()) await directory.delete(recursive: true);
  });

  test('survives a process-style queue instance restart', () async {
    await GpsPointQueue(directory).append('duty-1', point('p-1', 1));
    final restored = await GpsPointQueue(directory).restore('duty-1');
    expect(restored.map((item) => item['clientPointId']), ['p-1']);
  });

  test('partial acknowledgement keeps failed chunks on disk', () async {
    final queue = GpsPointQueue(directory);
    await queue.append('duty-1', point('p-1', 1));
    await queue.append('duty-1', point('p-2', 2));
    await queue.append('duty-1', point('p-3', 3));
    await queue.acknowledge('duty-1', ['p-1', 'p-2']);
    final restored = await GpsPointQueue(directory).restore('duty-1');
    expect(restored.map((item) => item['clientPointId']), ['p-3']);
  });

  test('duplicate retry stays idempotent', () async {
    final queue = GpsPointQueue(directory);
    await queue.append('duty-1', point('p-1', 1));
    await queue.append('duty-1', point('p-1', 1));
    expect(await queue.restore('duty-1'), hasLength(1));
  });

  test('lists pending duties without mixing their points', () async {
    final queue = GpsPointQueue(directory);
    await queue.append('duty-2', point('p-2', 2));
    await queue.append('duty-1', point('p-1', 1));
    expect(await queue.pendingDutyIds(), ['duty-1', 'duty-2']);
    expect((await queue.restore('duty-1')).single['clientPointId'], 'p-1');
    expect((await queue.restore('duty-2')).single['clientPointId'], 'p-2');
  });

  test('recovers the previous queue after an interrupted file replacement',
      () async {
    final queue = GpsPointQueue(directory);
    await queue.append('duty-1', point('p-1', 1));
    final current = File('${directory.path}/duty-1.json');
    await current.rename('${current.path}.bak');
    final restored = await GpsPointQueue(directory).restore('duty-1');
    expect(restored.single['clientPointId'], 'p-1');
  });
}

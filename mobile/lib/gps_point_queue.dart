import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Durable, per-duty queue. A point remains on disk until the field-duty API
/// acknowledges its clientPointId (or explicitly rejects it as terminally
/// invalid). This makes location capture resilient to offline use and restarts.
class GpsPointQueue {
  GpsPointQueue(this.root);

  final Directory root;
  Future<void> _tail = Future<void>.value();

  Future<T> _locked<T>(Future<T> Function() action) {
    final result = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        result.complete(await action());
      } catch (error, stack) {
        result.completeError(error, stack);
      }
    });
    return result.future;
  }

  String _safe(String dutyId) =>
      dutyId.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');

  File _file(String dutyId) => File('${root.path}/${_safe(dutyId)}.json');

  File _backup(String dutyId) => File('${_file(dutyId).path}.bak');

  String _id(Map<String, dynamic> point) =>
      '${point['clientPointId'] ?? point['recordedAt'] ?? ''}';

  Future<List<Map<String, dynamic>>> _readUnlocked(String dutyId) async {
    var file = _file(dutyId);
    final backup = _backup(dutyId);
    // Recover an interrupted atomic replacement. A crash can happen after the
    // previous file becomes .bak but before the new file is renamed.
    if (!await file.exists() && await backup.exists()) {
      await backup.rename(file.path);
      file = _file(dutyId);
    }
    if (!await file.exists()) return [];
    final text = await file.readAsString();
    if (text.trim().isEmpty) return [];
    final decoded = jsonDecode(text);
    if (decoded is! List) return [];
    final unique = <String, Map<String, dynamic>>{};
    for (final item in decoded.whereType<Map>()) {
      final point = Map<String, dynamic>.from(item);
      final id = _id(point);
      if (id.isNotEmpty) unique[id] = point;
    }
    return unique.values.toList();
  }

  Future<void> _writeUnlocked(
      String dutyId, List<Map<String, dynamic>> points) async {
    await root.create(recursive: true);
    final file = _file(dutyId);
    if (points.isEmpty) {
      if (await file.exists()) await file.delete();
      return;
    }
    final temporary = File('${file.path}.tmp');
    final backup = _backup(dutyId);
    await temporary.writeAsString(jsonEncode(points), flush: true);
    if (await backup.exists()) await backup.delete();
    if (await file.exists()) await file.rename(backup.path);
    try {
      await temporary.rename(file.path);
      if (await backup.exists()) await backup.delete();
    } catch (_) {
      if (await file.exists()) await file.delete();
      if (await backup.exists()) await backup.rename(file.path);
      rethrow;
    }
  }

  Future<List<String>> pendingDutyIds() => _locked(() async {
        if (!await root.exists()) return <String>[];
        final ids = <String>{};
        await for (final entity in root.list()) {
          if (entity is! File) continue;
          final name = entity.uri.pathSegments.last;
          if (name.endsWith('.json')) {
            ids.add(name.substring(0, name.length - 5));
          } else if (name.endsWith('.json.bak')) {
            ids.add(name.substring(0, name.length - 9));
          }
        }
        final sorted = ids.toList()..sort();
        return sorted;
      });

  Future<List<Map<String, dynamic>>> restore(String dutyId) =>
      _locked(() => _readUnlocked(dutyId));

  Future<void> append(String dutyId, Map<String, dynamic> point) =>
      _locked(() async {
        final points = await _readUnlocked(dutyId);
        final id = _id(point);
        if (id.isEmpty) throw StateError('GPS point is missing clientPointId.');
        final byId = {for (final item in points) _id(item): item};
        byId[id] = Map<String, dynamic>.from(point);
        await _writeUnlocked(dutyId, byId.values.toList());
      });

  Future<void> acknowledge(String dutyId, Iterable<String> pointIds) =>
      _locked(() async {
        final ids = pointIds.where((id) => id.isNotEmpty).toSet();
        if (ids.isEmpty) return;
        final remaining = (await _readUnlocked(dutyId))
            .where((point) => !ids.contains(_id(point)))
            .toList();
        await _writeUnlocked(dutyId, remaining);
      });
}

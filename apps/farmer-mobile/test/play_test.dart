import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agrosense_farmer/play.dart';

void main() {
  Map<String, dynamic> result(String status, [String? condition]) => {
    'status': status,
    'candidates': [
      if (condition != null) {'condition': condition},
    ],
  };

  test('each AI outcome gets its own friendly look', () {
    expect(
      lookFor(result('accepted', 'Healthy'), 'completed').headline,
      'Looks healthy!',
    );
    expect(
      lookFor(result('accepted', 'Early blight'), 'completed').headline,
      'Needs some care',
    );
    expect(lookFor(result('uncertain', 'Leaf spot'), 'completed').emoji, '🤔');
    expect(lookFor(result('retake'), 'completed').color, sky);
    expect(
      lookFor(result('unsupported'), 'completed').headline,
      'No crop plant found',
    );
    expect(lookFor(null, 'queued').headline, 'Looking closely…');
    expect(lookFor(null, 'failed').headline, 'Something went wrong');
  });

  test('plants get a matching emoji, anything else a leaf', () {
    expect(plantEmoji('Tomato'), '🍅');
    expect(plantEmoji('Maize (corn)'), '🌽');
    expect(plantEmoji('Mahangu (pearl millet)'), '🌾');
    expect(plantEmoji('Baobab'), '🌿');
    expect(plantEmoji(null), '🌿');
  });

  test('check times read like a person would say them', () {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day, 9, 5);
    expect(taken(today.toUtc().toIso8601String()), 'Today, 09:05');
    expect(
      taken(today.subtract(const Duration(days: 1)).toUtc().toIso8601String()),
      'Yesterday, 09:05',
    );
    expect(
      taken(DateTime(2025, 9, 29, 12).toUtc().toIso8601String()),
      '29 Sep',
    );
    expect(taken(null), '');
  });

  testWidgets('pills and bubbles render their text', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Row(
          children: [pill('high confidence', mint), bubble('🍅', peach)],
        ),
      ),
    );
    expect(find.text('high confidence'), findsOneWidget);
    expect(find.text('🍅'), findsOneWidget);
  });
}

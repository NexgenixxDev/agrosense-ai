import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agrosense_farmer/main.dart';

void main() {
  testWidgets(
    'capture offers a gallery alternative and cannot submit without a photo',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: CropCheck(fields: [])));
      expect(find.text('Take a photo'), findsOneWidget);
      expect(find.text('Choose from gallery'), findsOneWidget);
      expect(find.text('Save and submit crop check'), findsNothing);
      expect(find.text('No field selected'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

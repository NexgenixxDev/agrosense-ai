import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

class LocalReminders {
  final plugin = FlutterLocalNotificationsPlugin();
  Future<void> init() async {
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Africa/Windhoek'));
    await plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
    );
  }

  int notificationId(String id) =>
      int.parse(id.replaceAll('-', '').substring(0, 7), radix: 16);
  Future<bool> schedule(String id, String title, DateTime due) async {
    final granted = await plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    if (granted == false) {
      return false;
    }
    await plugin.zonedSchedule(
      notificationId(id),
      'AgroSense reminder',
      title,
      tz.TZDateTime.from(due, tz.local),
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'crop-care',
          'Crop care reminders',
          channelDescription: 'Reminders you schedule for your fields',
          importance: Importance.defaultImportance,
        ),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
    );
    return true;
  }

  Future<void> cancel(String id) => plugin.cancel(notificationId(id));
}

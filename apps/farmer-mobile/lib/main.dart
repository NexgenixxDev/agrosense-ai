import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'data.dart';
import 'reminders.dart';

const green = Color(0xFF166534);
const ink = Color(0xFF17251C);
final farm = FarmData();
final reminders = LocalReminders();
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await farm.init();
  await reminders.init();
  runApp(const AgroSenseApp());
  // Android may recreate the activity while a camera application is open.
  final lost = await ImagePicker().retrieveLostData();
  if (lost.files != null) {
    final Json pending = await farm.cached(
      'pending_capture',
      <String, dynamic>{},
    );
    for (final file in lost.files!) {
      await farm.capture(
        file.path,
        pending['crop'] ?? 'tomato',
        pending['field_id'],
      );
    }
  }
}

class AgroSenseApp extends StatelessWidget {
  const AgroSenseApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AgroSense',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      fontFamily: 'Arial',
      colorScheme: ColorScheme.fromSeed(
        seedColor: green,
        surface: const Color(0xFFF7FAF5),
      ),
      scaffoldBackgroundColor: const Color(0xFFF7FAF5),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(fontSize: 17, color: ink),
        bodyMedium: TextStyle(fontSize: 16, color: ink),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF7FAF5),
        foregroundColor: ink,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFDDE5D8)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    ),
    home: const FarmerHome(),
  );
}

class FarmerHome extends StatefulWidget {
  const FarmerHome({super.key});
  @override
  State<FarmerHome> createState() => _FarmerHomeState();
}

class _FarmerHomeState extends State<FarmerHome> with WidgetsBindingObserver {
  int tab = 0;
  bool busy = false;
  List<dynamic> fields = [],
      cases = [],
      drafts = [],
      advice = [],
      localReminders = [];
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    farm.addListener(reload);
    reload();
    farm.refresh().catchError((_) {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    farm.removeListener(reload);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      farm.sync();
    }
  }

  Future<void> reload() async {
    final f = await farm.cached('fields');
    final c = await farm.cached('cases');
    final d = await farm.drafts();
    final a = await farm.cached('advice');
    final r = await farm.db.query('reminders', orderBy: 'due_at');
    if (mounted) {
      setState(() {
        fields = f;
        cases = c;
        drafts = d;
        advice = a;
        localReminders = r;
      });
    }
  }

  void message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(text), duration: const Duration(seconds: 5)),
      );
    }
  }

  Future<void> action(Future<void> Function() fn) async {
    setState(() => busy = true);
    try {
      await fn();
      await reload();
    } catch (e) {
      message(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> login() async {
    if (farm.token != null) {
      return;
    }
    if (!developmentLogin) {
      throw Exception(
        'Phone sign-in is not configured yet. You can still save photos and drafts on this phone.',
      );
    }
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Development sign-in'),
        content: const Text(
          'Use the local demo farmer account. This is not phone verification and is disabled in production.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Use demo farmer'),
          ),
        ],
      ),
    );
    if (yes != true) {
      throw Exception('Sign-in cancelled. Your draft is saved.');
    }
    await farm.login();
  }

  Future<void> capture() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => CropCheck(fields: fields)),
    );
    await reload();
  }

  Future<void> addField() async {
    await login();
    if (!mounted) {
      return;
    }
    final name = TextEditingController();
    final region = TextEditingController();
    String crop = 'tomato', production = 'rain_fed';
    final key = GlobalKey<FormState>();
    final value = await showDialog<Json>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, update) => AlertDialog(
          title: const Text('Add your field'),
          content: SingleChildScrollView(
            child: Form(
              key: key,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Field name'),
                    validator: (v) => v!.trim().isEmpty ? 'Enter a name' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: region,
                    decoration: const InputDecoration(labelText: 'Region'),
                    validator: (v) =>
                        v!.trim().isEmpty ? 'Enter your region' : null,
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: crop,
                    decoration: const InputDecoration(labelText: 'Crop'),
                    items: cropItems(),
                    onChanged: (v) => update(() => crop = v!),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: production,
                    decoration: const InputDecoration(
                      labelText: 'How does this field get water?',
                    ),
                    isExpanded: true,
                    items: const [
                      DropdownMenuItem(
                        value: 'rain_fed',
                        child: Text('Rain-fed'),
                      ),
                      DropdownMenuItem(
                        value: 'irrigated',
                        child: Text('Irrigated'),
                      ),
                    ],
                    onChanged: (v) => update(() => production = v!),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (key.currentState!.validate()) {
                  Navigator.pop(c, {
                    'name': name.text.trim(),
                    'region': region.text.trim(),
                    'crop': crop,
                    'production_type': production,
                  });
                }
              },
              child: const Text('Save field'),
            ),
          ],
        ),
      ),
    );
    if (value != null) {
      await farm.request('/fields', method: 'POST', body: value);
      await farm.refresh();
    }
  }

  Future<void> addReminder() async {
    final title = TextEditingController(text: 'Inspect my crop');
    final text = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Set a crop reminder'),
        content: TextField(
          controller: title,
          decoration: const InputDecoration(
            labelText: 'What would you like to do?',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (title.text.trim().isNotEmpty) {
                Navigator.pop(c, title.text.trim());
              }
            },
            child: const Text('Choose time'),
          ),
        ],
      ),
    );
    if (text == null || !mounted) {
      return;
    }
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) {
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 8, minute: 0),
    );
    if (time == null) {
      return;
    }
    final due = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    if (!due.isAfter(DateTime.now())) {
      throw Exception('Choose a future time.');
    }
    final id = uuid.v4();
    await farm.db.insert('reminders', {
      'id': id,
      'title': text,
      'due_at': due.toUtc().toIso8601String(),
    });
    bool scheduled = false;
    try {
      scheduled = await reminders.schedule(id, text, due);
    } catch (_) {
      scheduled = false;
    }
    await farm.db.update(
      'reminders',
      {'scheduled': scheduled ? 1 : 0},
      where: 'id=?',
      whereArgs: [id],
    );
    message(
      scheduled
          ? 'Reminder saved. It works without internet.'
          : 'Reminder saved in your list. Notifications are unavailable; check it here.',
    );
    farm.sync();
  }

  Widget heading(String title, String subtitle) => Padding(
    padding: const EdgeInsets.only(top: 8, bottom: 22),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 29,
            fontWeight: FontWeight.w700,
            height: 1.2,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: const TextStyle(color: Color(0xFF6D7968), height: 1.5),
        ),
      ],
    ),
  );
  Widget card(Widget child) => Container(
    margin: const EdgeInsets.only(bottom: 14),
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(17),
      border: Border.all(color: const Color(0xFFE3E9DD)),
    ),
    child: child,
  );
  Widget section(String title, {Widget? trailing}) => Padding(
    padding: const EdgeInsets.only(top: 15, bottom: 12),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
        ),
        ?trailing,
      ],
    ),
  );
  Widget caseTile(Json c) => card(
    ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: const Color(0xFFECF3E3),
        child: Icon(Icons.eco_outlined, color: green),
      ),
      title: Text(
        '${titleCase(c['crop'])} crop check',
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        '${friendly(c['processing_state'])}\nReview: ${friendly(c['review_state'])}',
        style: const TextStyle(fontSize: 14, height: 1.6),
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => CasePage(id: c['id'])),
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.spa, color: green),
          SizedBox(width: 9),
          Text(
            'AgroSense',
            style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: -.7),
          ),
          SizedBox(width: 7),
          Text(
            'AI',
            style: TextStyle(
              fontSize: 11,
              color: green,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Sync saved work',
          onPressed: busy || farm.syncing
              ? null
              : () => action(() => farm.sync(force: true)),
          icon: const Icon(Icons.sync),
        ),
        const SizedBox(width: 8),
      ],
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: tab,
      onDestinationSelected: (v) {
        if (v == 1) {
          action(capture);
        } else {
          setState(() => tab = v);
        }
      },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home),
          label: 'Home',
        ),
        NavigationDestination(
          icon: Icon(Icons.add_a_photo_outlined),
          label: 'Check Crop',
        ),
        NavigationDestination(
          icon: Icon(Icons.grass_outlined),
          label: 'My Farm',
        ),
        NavigationDestination(icon: Icon(Icons.help_outline), label: 'Help'),
      ],
    ),
    body: SafeArea(
      child: RefreshIndicator(
        onRefresh: () => action(() => farm.sync(force: true)),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 14, 22, 32),
          children: [
            if (busy || farm.syncing) const LinearProgressIndicator(),
            if (developmentLogin)
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text(
                  'DEVELOPMENT BUILD · SAMPLE ACCOUNT',
                  style: TextStyle(
                    fontSize: 10,
                    letterSpacing: 1.2,
                    color: Color(0xFF9A691B),
                  ),
                ),
              ),
            if (tab == 0) ...[
              heading(
                'A little care.\nA healthier harvest.',
                'Let’s take a closer look at your crops.',
              ),
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: const Color(0xFF19492D),
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'GROWING TOGETHER',
                          style: TextStyle(
                            color: Color(0xFFC4D8AF),
                            fontSize: 10,
                            letterSpacing: 1.7,
                          ),
                        ),
                        Icon(
                          Icons.spa_outlined,
                          color: Color(0xFFBACE91),
                          size: 42,
                        ),
                      ],
                    ),
                    const SizedBox(height: 13),
                    const Text(
                      'Something looks\na little different?',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w600,
                        height: 1.15,
                      ),
                    ),
                    const SizedBox(height: 13),
                    const Text(
                      'Take a photo, share what you see,\nand find your next step.',
                      style: TextStyle(
                        color: Color(0xFFD1DFC8),
                        fontSize: 16,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 24),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFFEBF3D5),
                        foregroundColor: ink,
                        minimumSize: const Size(double.infinity, 54),
                      ),
                      onPressed: busy ? null : () => action(capture),
                      icon: const Icon(Icons.camera_alt_outlined),
                      label: const Text(
                        'Check my crop',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.cloud_done_outlined,
                      size: 18,
                      color: Color(0xFF718668),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        farm.status,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF718668),
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              section(
                'Your crop checks',
                trailing: Text(
                  '${cases.length}',
                  style: const TextStyle(color: green),
                ),
              ),
              if (cases.isEmpty)
                card(
                  const Column(
                    children: [
                      Icon(
                        Icons.eco_outlined,
                        size: 35,
                        color: Color(0xFF88A378),
                      ),
                      SizedBox(height: 12),
                      Text(
                        'Start with one photo',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                        ),
                      ),
                      SizedBox(height: 9),
                      Text(
                        'Your saved crop checks and advisor responses will appear here.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Color(0xFF71806A), height: 1.5),
                      ),
                    ],
                  ),
                ),
              ...cases
                  .take(5)
                  .map((c) => caseTile(Map<String, dynamic>.from(c))),
              if (drafts.isNotEmpty) ...[
                section('Saved on this phone'),
                ...drafts.map(
                  (d) => card(
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${titleCase(jsonDecode(d['payload'])['crop'])} · ${d['ready'] == 1 ? 'Waiting to upload' : 'Draft'}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        if (d['error'] != null)
                          Text(
                            d['error'],
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFFB45309),
                            ),
                          ),
                        Row(
                          children: [
                            Expanded(
                              child: TextButton(
                                onPressed: busy
                                    ? null
                                    : () => action(() async {
                                        if (d['ready'] == 1) {
                                          await login();
                                          await farm.sync(force: true);
                                        } else {
                                          await Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => CropCheck(
                                                fields: fields,
                                                draft:
                                                    Map<String, dynamic>.from(
                                                      d,
                                                    ),
                                              ),
                                            ),
                                          );
                                        }
                                      }),
                                child: Text(
                                  d['ready'] == 1
                                      ? 'Retry upload'
                                      : 'Continue draft',
                                ),
                              ),
                            ),
                            if (d['server_id'] == null)
                              IconButton(
                                tooltip: 'Delete unsent draft',
                                onPressed: busy || farm.syncing
                                    ? null
                                    : () => action(
                                        () => farm.deleteDraft(
                                          Map<String, dynamic>.from(d),
                                        ),
                                      ),
                                icon: const Icon(Icons.delete_outline),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              section('A note from the field'),
              card(
                const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.lightbulb_outline, color: green),
                    SizedBox(width: 13),
                    Expanded(
                      child: Text(
                        'A photo is one part of the picture. Keep an eye on the whole plant and record changes over time.',
                        style: TextStyle(height: 1.5),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (tab == 2) ...[
              heading(
                'Your farm, at a glance.',
                'Keep your fields and next steps in one place.',
              ),
              section(
                'My fields',
                trailing: TextButton.icon(
                  onPressed: busy ? null : () => action(addField),
                  icon: const Icon(Icons.add),
                  label: const Text('Add field'),
                ),
              ),
              if (fields.isEmpty)
                card(
                  const Text(
                    'Add a field with its crop, region and water source. Precise location is not required.',
                  ),
                ),
              ...fields.map(
                (f) => card(
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.grass, color: green, size: 33),
                    title: Text(
                      f['name'],
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${titleCase(f['crop'])} · ${f['region']}\n${friendly(f['production_type'])}',
                      style: const TextStyle(height: 1.6),
                    ),
                  ),
                ),
              ),
              section(
                'My reminders',
                trailing: IconButton(
                  tooltip: 'Add reminder',
                  onPressed: busy ? null : () => action(addReminder),
                  icon: const Icon(Icons.add_alarm),
                ),
              ),
              ...localReminders.map(
                (r) => card(
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: r['completed'] == 1,
                    title: Text(r['title']),
                    subtitle: Text(
                      '${DateTime.parse(r['due_at']).toLocal().toString().substring(0, 16)}\n${r['scheduled'] == 1 ? 'Phone notification scheduled' : 'Saved in this list; no notification'}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    onChanged: (v) => action(() async {
                      await farm.db.update(
                        'reminders',
                        {'completed': v! ? 1 : 0, 'synced': 0},
                        where: 'id=?',
                        whereArgs: [r['id']],
                      );
                      if (v) {
                        await reminders.cancel(r['id']);
                      }
                      farm.sync();
                    }),
                  ),
                ),
              ),
              if (localReminders.isEmpty)
                card(
                  const Text(
                    'Schedule an inspection or your own watering reminder. No water quantities are inferred from photos.',
                  ),
                ),
              section('All crop checks'),
              ...cases.map((c) => caseTile(Map<String, dynamic>.from(c))),
            ],
            if (tab == 3) ...[
              heading(
                'A helping hand.',
                'Clear guidance, with room for human expertise.',
              ),
              card(
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'How a crop check works',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    SizedBox(height: 15),
                    Text(
                      '1. Choose your crop and take a clear photo.\n\n2. Tell us what you see and save the case.\n\n3. Read the result or request an advisor review.\n\n4. Come back and record how the crop changes.',
                      style: TextStyle(height: 1.5),
                    ),
                  ],
                ),
              ),
              card(
                const Text(
                  'Automatic crop assessment depends on a configured, evaluated model. Mahangu and sorghum currently use advisor referral. A healthy-looking photo does not prove the whole crop is disease-free.',
                  style: TextStyle(height: 1.5),
                ),
              ),
              card(
                const Text(
                  'Privacy: submitting sends the photo and observations to the configured server and inference service. Precise location is optional. Training reuse is off unless you separately choose it. This development build is not a public service.',
                  style: TextStyle(height: 1.5),
                ),
              ),
              section('Saved guidance'),
              ...advice.map(
                (a) => card(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (a['development_only'] == 1)
                        const Text(
                          'DEVELOPMENT EXAMPLE · NOT FIELD-APPROVED',
                          style: TextStyle(
                            color: Color(0xFFB45309),
                            fontSize: 11,
                          ),
                        ),
                      const SizedBox(height: 8),
                      Text(
                        a['title'],
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(a['body'], style: const TextStyle(height: 1.5)),
                      const SizedBox(height: 12),
                      Text(
                        'Version ${a['version']} · Reviewer ${a['reviewer_id']}\n${a['sources'].join('\n')}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF71806A),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (advice.isEmpty)
                card(
                  const Text(
                    'No downloaded guidance yet. Refresh when connected.',
                  ),
                ),
              if (farm.token == null)
                FilledButton(
                  onPressed: busy ? null : () => action(login),
                  child: Text(
                    developmentLogin ? 'Development sign-in' : 'Sign in',
                  ),
                ),
            ],
          ],
        ),
      ),
    ),
  );
}

List<DropdownMenuItem<String>> cropItems() => [
  'tomato',
  'maize',
  'mahangu',
  'sorghum',
].map((c) => DropdownMenuItem(value: c, child: Text(titleCase(c)))).toList();
String friendly(dynamic s) => (s?.toString() ?? '').replaceAll('_', ' ');
String titleCase(String s) =>
    s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

class CropCheck extends StatefulWidget {
  final List<dynamic> fields;
  final Json? draft;
  const CropCheck({super.key, required this.fields, this.draft});
  @override
  State<CropCheck> createState() => _CropCheckState();
}

class _CropCheckState extends State<CropCheck> {
  String crop = 'tomato';
  String? fieldId, draftId, photo;
  bool consent = false, training = false, busy = false;
  String? error;
  final inputs = {
    for (final key in ['parts', 'duration', 'insects', 'spread', 'water'])
      key: TextEditingController(),
  };
  final labels = {
    'parts': 'Which parts are affected?',
    'duration': 'How long have you noticed this?',
    'insects': 'Have you seen insects?',
    'spread': 'One plant or many plants?',
    'water': 'Recent rainfall or watering?',
  };
  @override
  void initState() {
    super.initState();
    if (widget.draft != null) {
      final d = widget.draft!;
      final p = jsonDecode(d['payload']);
      crop = p['crop'];
      fieldId = p['field_id'];
      draftId = d['id'];
      photo = d['photo'];
      training = p['training_consent'];
      for (final key in inputs.keys) {
        inputs[key]!.text = p['symptoms'][key];
      }
    }
  }

  @override
  void dispose() {
    for (final c in inputs.values) {
      c.dispose();
    }
    super.dispose();
  }

  Json payload() => {
    'client_submission_id': draftId,
    'field_id': fieldId,
    'crop': crop,
    'symptoms': {for (final e in inputs.entries) e.key: e.value.text.trim()},
    'consent_version': '2026-09-29',
    'training_consent': training,
  };
  Future<void> save() async {
    if (draftId != null) {
      await farm.updateDraft(draftId!, payload());
    }
  }

  Future<void> pick(ImageSource source) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await farm.cache('pending_capture', {'crop': crop, 'field_id': fieldId});
      final file = await ImagePicker().pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1600,
        maxHeight: 1600,
      );
      if (file != null) {
        final key = await farm.capture(file.path, crop, fieldId);
        final rows = await farm.db.query(
          'drafts',
          where: 'id=?',
          whereArgs: [key],
        );
        if (mounted) {
          setState(() {
            draftId = key;
            photo = rows.first['photo'] as String;
          });
        }
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'Camera unavailable or permission denied. Try choosing a photo from your gallery.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await farm.updateDraft(draftId!, payload(), ready: true);
      if (farm.token == null) {
        if (!developmentLogin) {
          throw Exception(
            'Draft saved. Sign-in must be configured before upload.',
          );
        }
        await farm.login();
      }
      await farm.sync(force: true);
      if (mounted) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => error =
              'Saved on this phone. ${e.toString().replaceFirst('Exception: ', '')}',
        );
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Check your crop')),
    body: ListView(
      padding: const EdgeInsets.all(22),
      children: [
        const Text(
          'Let’s take a closer look.',
          style: TextStyle(fontSize: 27, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        const Text(
          'Use a clear close-up in even light. Keep the affected part in focus.',
          style: TextStyle(height: 1.5, color: Color(0xFF687961)),
        ),
        const SizedBox(height: 24),
        DropdownButtonFormField<String>(
          initialValue: crop,
          decoration: const InputDecoration(labelText: 'Crop'),
          items: cropItems(),
          onChanged: photo != null
              ? null
              : (v) => setState(() {
                  crop = v!;
                  fieldId = null;
                }),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          key: ValueKey(crop),
          initialValue: fieldId,
          decoration: const InputDecoration(labelText: 'Field (optional)'),
          items: [
            const DropdownMenuItem<String>(
              value: null,
              child: Text('No field selected'),
            ),
            ...widget.fields
                .where((f) => f['crop'] == crop)
                .map(
                  (f) => DropdownMenuItem<String>(
                    value: f['id'],
                    child: Text(f['name']),
                  ),
                ),
          ],
          onChanged: photo != null ? null : (v) => setState(() => fieldId = v),
        ),
        const SizedBox(height: 20),
        if (photo == null) ...[
          Container(
            height: 180,
            decoration: BoxDecoration(
              color: const Color(0xFFEDF3E5),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFCCDDBE)),
            ),
            child: const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.center_focus_strong, size: 54, color: green),
                SizedBox(height: 12),
                Text('One clear photo is a good start.'),
              ],
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: busy ? null : () => pick(ImageSource.camera),
            icon: const Icon(Icons.camera_alt_outlined),
            label: const Text('Take a photo'),
          ),
          TextButton.icon(
            onPressed: busy ? null : () => pick(ImageSource.gallery),
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('Choose from gallery'),
          ),
        ],
        if (photo != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.file(File(photo!), height: 220, fit: BoxFit.cover),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'Photo saved on this phone',
              style: TextStyle(color: green, fontSize: 13),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'What have you noticed?',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 18),
          ...inputs.entries.map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: 17),
              child: TextField(
                controller: e.value,
                maxLength: e.key == 'duration' || e.key == 'insects'
                    ? 100
                    : 200,
                decoration: InputDecoration(
                  labelText: labels[e.key],
                  counterText: '',
                ),
                onChanged: (_) => save(),
              ),
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: consent,
            onChanged: (v) => setState(() => consent = v!),
            title: const Text(
              'I agree to send this photo and observations for assessment.',
              style: TextStyle(fontSize: 15),
            ),
            subtitle: const Text(
              'Required to upload. Photos may be processed by the configured AI provider.',
              style: TextStyle(fontSize: 12),
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: training,
            onChanged: (v) {
              setState(() => training = v!);
              save();
            },
            title: const Text(
              'Optional: allow use for future model research.',
              style: TextStyle(fontSize: 15),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: busy || !consent ? null : submit,
            icon: const Icon(Icons.cloud_upload_outlined),
            label: Text(busy ? 'Saving…' : 'Save and submit crop check'),
          ),
          TextButton(
            onPressed: busy
                ? null
                : () async {
                    await save();
                    if (context.mounted) {
                      Navigator.pop(context);
                    }
                  },
            child: const Text('Keep as an offline draft'),
          ),
        ],
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 15),
            child: Text(
              error!,
              style: const TextStyle(color: Color(0xFFB45309), height: 1.5),
            ),
          ),
        if (developmentLogin)
          const Padding(
            padding: EdgeInsets.only(top: 18),
            child: Text(
              'Development build: submission uses the demo farmer account. Real diagnosis requires a configured model.',
              style: TextStyle(
                fontSize: 12,
                color: Color(0xFF887345),
                height: 1.5,
              ),
            ),
          ),
      ],
    ),
  );
}

class CasePage extends StatefulWidget {
  final String id;
  const CasePage({super.key, required this.id});
  @override
  State<CasePage> createState() => _CasePageState();
}

class _CasePageState extends State<CasePage> {
  Json? data;
  String? error;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final cached = await farm.cached('case:${widget.id}', <String, dynamic>{});
    if (mounted && cached.isNotEmpty) {
      setState(() => data = Map<String, dynamic>.from(cached));
    }
    try {
      final Json fresh = await farm.request('/cases/${widget.id}');
      await farm.cache('case:${widget.id}', fresh);
      if (mounted) {
        setState(() {
          data = fresh;
          error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'Showing saved information. Connect to refresh this case.',
        );
      }
    }
  }

  Future<void> post(String suffix, [Json? payload]) async {
    setState(() => busy = true);
    try {
      await farm.request(
        '/cases/${widget.id}/$suffix',
        method: 'POST',
        body: payload,
      );
      await load();
    } catch (e) {
      if (mounted) {
        setState(() => error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> follow() async {
    String outcome = 'same';
    final notes = TextEditingController();
    final result = await showDialog<Json>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, update) => AlertDialog(
          title: const Text('How is your crop doing?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: outcome,
                items: const [
                  DropdownMenuItem(value: 'improved', child: Text('Improved')),
                  DropdownMenuItem(
                    value: 'same',
                    child: Text('Stayed the same'),
                  ),
                  DropdownMenuItem(value: 'worsened', child: Text('Worsened')),
                ],
                onChanged: (v) => update(() => outcome = v!),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: notes,
                maxLength: 2000,
                decoration: const InputDecoration(
                  labelText: 'What changed or what did you do?',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, {
                'client_id': uuid.v4(),
                'outcome': outcome,
                'notes': notes.text,
              }),
              child: const Text('Save follow-up'),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await post('follow-ups', result);
    }
  }

  Widget block(String title, Widget child) => Container(
    margin: const EdgeInsets.only(bottom: 18),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFE1E8DA)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 13),
        child,
      ],
    ),
  );
  @override
  Widget build(BuildContext context) {
    final a = data?['analysis'];
    final guidance = data?['advice'];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your crop check'),
        actions: [
          IconButton(
            tooltip: 'Refresh case',
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: data == null
          ? Center(child: Text(error ?? 'Loading crop check…'))
          : ListView(
              padding: const EdgeInsets.all(22),
              children: [
                Text(
                  '${titleCase(data!['crop'])} · ${widget.id.substring(0, 8)}',
                  style: const TextStyle(
                    fontSize: 25,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text('Processing: ${friendly(data!['processing_state'])}'),
                const SizedBox(height: 20),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 18),
                    child: Text(
                      error!,
                      style: const TextStyle(color: Color(0xFFB45309)),
                    ),
                  ),
                block(
                  'AI assessment',
                  a == null
                      ? const Text(
                          'No result yet. Refresh to check progress. Your case is saved.',
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (a['mode'] == 'fixture')
                              const Text(
                                'DEVELOPMENT FIXTURE · NOT A DIAGNOSIS',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFFB45309),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            const SizedBox(height: 10),
                            Text(
                              titleCase(a['status']),
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              a['reason'],
                              style: const TextStyle(height: 1.5),
                            ),
                            ...a['candidates'].map<Widget>(
                              (c) => Padding(
                                padding: const EdgeInsets.only(top: 12),
                                child: Text(
                                  'Possible cause: ${friendly(c['condition'])}',
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'Model: ${a['model_version']}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: Color(0xFF75816D),
                              ),
                            ),
                          ],
                        ),
                ),
                block(
                  'Guidance and next steps',
                  guidance == null
                      ? const Text(
                          'No matching reviewed guidance is available. Request an advisor review for the next step.',
                          style: TextStyle(height: 1.5),
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (guidance['development_only'] == 1)
                              const Text(
                                'DEVELOPMENT EXAMPLE',
                                style: TextStyle(
                                  color: Color(0xFFB45309),
                                  fontSize: 12,
                                ),
                              ),
                            Text(
                              guidance['body'],
                              style: const TextStyle(height: 1.5),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'Version ${guidance['version']} · Reviewed ${guidance['reviewed_at']}\n${guidance['sources'].join('\n')}',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ],
                        ),
                ),
                block(
                  'Advisor review',
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Status: ${friendly(data!['review_state'])}'),
                      const SizedBox(height: 10),
                      if (data!['advisor_id'] == null)
                        const Text(
                          'No advisor is assigned yet. A response time is not guaranteed.',
                          style: TextStyle(fontSize: 14, height: 1.5),
                        ),
                      ...data!['reviews'].map<Widget>(
                        (r) => Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Advisor reviewed',
                                style: TextStyle(
                                  color: green,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                r['response'],
                                style: const TextStyle(height: 1.5),
                              ),
                              if (r['correction'] != null)
                                Text('Correction: ${r['correction']}'),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (data!['review_state'] == 'not_requested')
                  FilledButton.icon(
                    onPressed: busy ? null : () => post('review'),
                    icon: const Icon(Icons.person_outline),
                    label: const Text('Request advisor review'),
                  ),
                if (data!['processing_state'] == 'failed')
                  FilledButton(
                    onPressed: busy ? null : () => post('retry'),
                    child: const Text('Retry analysis'),
                  ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: busy ? null : follow,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 52),
                  ),
                  icon: const Icon(Icons.history),
                  label: const Text('Record a follow-up'),
                ),
                const SizedBox(height: 16),
                ...data!['followups'].map<Widget>(
                  (f) => block(titleCase(f['outcome']), Text(f['notes'])),
                ),
              ],
            ),
    );
  }
}

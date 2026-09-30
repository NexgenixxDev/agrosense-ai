// Playful screens for the simple school-project flow: snap a plant, get the AI result.
// The full app (fields, reminders, advisor review) lives in main.dart.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'data.dart';
import 'main.dart' show farm;

// Palette: warm cream, leaf green and soft pastels.
const cream = Color(0xFFFFF8EE);
const leaf = Color(0xFF2FA36B);
const leafDark = Color(0xFF1E7A4F);
const bark = Color(0xFF2F3A2F);
const mint = Color(0xFFD5F5E3);
const peach = Color(0xFFFFE0CC);
const sunshine = Color(0xFFFFF0B3);
const sky = Color(0xFFD9ECFF);
const lavender = Color(0xFFE9E1FF);
const coral = Color(0xFFE8664F);

ThemeData playTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: leaf,
    primary: leaf,
    surface: cream,
  );
  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Nunito',
    colorScheme: scheme,
    scaffoldBackgroundColor: cream,
    textTheme: const TextTheme(
      bodyLarge: TextStyle(fontSize: 17, color: bark),
      bodyMedium: TextStyle(fontSize: 16, color: bark),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: cream,
      foregroundColor: bark,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: leaf,
        foregroundColor: Colors.white,
        minimumSize: const Size(double.infinity, 58),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(
          fontFamily: 'Nunito',
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: leafDark,
        minimumSize: const Size(double.infinity, 54),
        shape: const StadiumBorder(),
        side: const BorderSide(color: leaf, width: 2),
        textStyle: const TextStyle(
          fontFamily: 'Nunito',
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: bark,
      shape: StadiumBorder(),
    ),
  );
}

/// How a result looks: emoji, headline and card colour for each AI outcome.
class Look {
  final String emoji, headline;
  final Color color;
  const Look(this.emoji, this.headline, this.color);
}

Look lookFor(Json? a, String? processing) {
  if (a == null) {
    return processing == 'failed'
        ? const Look('😕', 'Something went wrong', sunshine)
        : const Look('🔍', 'Looking closely…', sky);
  }
  final condition =
      ((a['candidates'] as List?)?.firstOrNull?['condition'] ?? '')
          .toString()
          .toLowerCase();
  switch (a['status']) {
    case 'accepted':
      return condition.contains('healthy')
          ? const Look('🎉', 'Looks healthy!', mint)
          : const Look('🩹', 'Needs some care', peach);
    case 'uncertain':
      return const Look('🤔', 'Hmm, not sure', sunshine);
    case 'retake':
      return const Look('📸', 'Try another photo', sky);
    case 'unsupported':
      return const Look('🔍', 'No plant found', lavender);
    default:
      return const Look('😴', 'The AI is resting', lavender);
  }
}

/// A friendly emoji for the plant the AI named.
String plantEmoji(String? plant) {
  final p = (plant ?? '').toLowerCase();
  const byWord = {
    'tomato': '🍅',
    'maize': '🌽',
    'corn': '🌽',
    'mahangu': '🌾',
    'millet': '🌾',
    'sorghum': '🌾',
    'wheat': '🌾',
    'spinach': '🥬',
    'cabbage': '🥬',
    'lettuce': '🥬',
    'potato': '🥔',
    'pepper': '🌶️',
    'chilli': '🌶️',
    'bean': '🫘',
    'pumpkin': '🎃',
    'squash': '🎃',
    'carrot': '🥕',
    'onion': '🧅',
    'melon': '🍉',
  };
  for (final e in byWord.entries) {
    if (p.contains(e.key)) return e.value;
  }
  return '🌿';
}

/// "Today, 10:34", "Yesterday, 08:02" or "29 Sep" for a case's timestamp.
String taken(String? iso) {
  final t = DateTime.tryParse(iso ?? '')?.toLocal();
  if (t == null) return '';
  final now = DateTime.now();
  final day = DateTime(t.year, t.month, t.day);
  final days = DateTime(now.year, now.month, now.day).difference(day).inDays;
  final time =
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  if (days == 0) return 'Today, $time';
  if (days == 1) return 'Yesterday, $time';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${t.day} ${months[t.month - 1]}';
}

Json? analysisOf(Json c) {
  final raw = c['analysis'];
  return raw == null ? null : (raw is String ? jsonDecode(raw) : raw);
}

Widget pill(String text, Color color) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
  decoration: BoxDecoration(
    color: color,
    borderRadius: BorderRadius.circular(99),
  ),
  child: Text(
    text,
    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
  ),
);

Widget bubble(String emoji, Color color, {double size = 52}) => Container(
  width: size,
  height: size,
  alignment: Alignment.center,
  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  child: Text(emoji, style: TextStyle(fontSize: size * 0.48)),
);

// ── Home ────────────────────────────────────────────────────────────────────

class PlayHome extends StatefulWidget {
  const PlayHome({super.key});
  @override
  State<PlayHome> createState() => _PlayHomeState();
}

class _PlayHomeState extends State<PlayHome> with WidgetsBindingObserver {
  List cases = [];
  List<Json> waiting = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    farm.addListener(reload);
    reload();
    refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    farm.removeListener(reload);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) farm.sync(force: true);
  }

  Future<void> refresh() async {
    try {
      if (farm.token == null) return;
      await farm.sync(force: true);
    } catch (_) {
      // Offline: the cached list and saved drafts still show.
    }
  }

  Future<void> reload() async {
    final c = await farm.cached('cases');
    final d = await farm.drafts();
    if (mounted) {
      setState(() {
        cases = c;
        waiting = d;
      });
    }
  }

  Future<void> check() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const PlayCheck()),
    );
    reload();
  }

  void help() => showModalBottomSheet(
    context: context,
    backgroundColor: cream,
    showDragHandle: true,
    builder: (_) => const Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Tips for a great check',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
          SizedBox(height: 16),
          Text('☀️  Good daylight, no flash', style: TextStyle(fontSize: 17)),
          SizedBox(height: 10),
          Text(
            '🍃  Get close to the sick leaf',
            style: TextStyle(fontSize: 17),
          ),
          SizedBox(height: 10),
          Text('✋  Hold still so it’s sharp', style: TextStyle(fontSize: 17)),
          SizedBox(height: 18),
          Text(
            'The AI gives suggestions, not a final diagnosis. Ask an extension officer before using chemicals.',
            style: TextStyle(fontSize: 14, color: Color(0xFF6B756B)),
          ),
        ],
      ),
    ),
  );

  Future<void> account() async {
    final signOut = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: cream,
      showDragHandle: true,
      builder: (c) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            bubble('🧑‍🌾', mint, size: 72),
            const SizedBox(height: 12),
            Text(
              farm.user?['name'] ?? 'Farmer',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            Text(
              farm.user?['phone'] ?? '',
              style: const TextStyle(color: Color(0xFF6B756B)),
            ),
            if (waiting.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Text(
                'Signing out deletes photos that haven’t been sent yet.',
                textAlign: TextAlign.center,
                style: TextStyle(color: coral),
              ),
            ],
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: () => Navigator.pop(c, true),
              icon: const Icon(Icons.logout_rounded),
              label: const Text('Sign out'),
            ),
          ],
        ),
      ),
    );
    if (signOut == true) await farm.signOut();
  }

  @override
  Widget build(BuildContext context) => farm.token == null
      ? const AuthScreen()
      : Scaffold(
          appBar: AppBar(
            title: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/logo.png', width: 34, height: 34),
                const SizedBox(width: 10),
                const Text(
                  'AgroSense',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 24),
                ),
              ],
            ),
            actions: [
              IconButton(
                tooltip: 'Tips',
                onPressed: help,
                icon: const Icon(Icons.help_outline_rounded),
              ),
              IconButton(
                tooltip: 'Account',
                onPressed: account,
                icon: const Icon(Icons.account_circle_rounded),
              ),
            ],
          ),
          body: RefreshIndicator(
            color: leaf,
            onRefresh: refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [mint, sunshine],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(32),
                  ),
                  child: Column(
                    children: [
                      const Text('🌿 🍅 🌽', style: TextStyle(fontSize: 46)),
                      const SizedBox(height: 12),
                      const Text(
                        'Is your plant okay?',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Snap a photo and find out.',
                        style: TextStyle(
                          fontSize: 17,
                          color: Color(0xFF55605A),
                        ),
                      ),
                      const SizedBox(height: 20),
                      FilledButton.icon(
                        onPressed: check,
                        icon: const Text('📸', style: TextStyle(fontSize: 22)),
                        label: const Text("Let's check!"),
                      ),
                    ],
                  ),
                ),
                if (waiting.isNotEmpty) ...[
                  const SizedBox(height: 22),
                  for (final d in waiting) draftCard(d),
                ],
                const SizedBox(height: 26),
                Row(
                  children: [
                    const Text(
                      'Your plants',
                      style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const Spacer(),
                    if (cases.isNotEmpty) pill('${cases.length}', mint),
                  ],
                ),
                const SizedBox(height: 12),
                if (cases.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 28),
                    child: Text(
                      'No checks yet. Your first one will show up here 🌱',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF6B756B)),
                    ),
                  ),
                for (final c in cases) caseCard(Map<String, dynamic>.from(c)),
              ],
            ),
          ),
        );

  Widget caseCard(Json c) {
    final a = analysisOf(c);
    final look = lookFor(a, c['processing_state']);
    final plant = a?['plant'] as String?;
    final condition =
        (a?['candidates'] as List?)?.firstOrNull?['condition'] as String?;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: () async {
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => PlayResult(id: c['id'])),
            );
            reload();
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                bubble(plantEmoji(plant), look.color),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        // Without a plant name, the result itself is the title.
                        plant ?? '${look.emoji} ${look.headline}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        plant == null
                            ? taken(c['created_at'])
                            : '${look.emoji} ${condition ?? look.headline}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Color(0xFF55605A)),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: leaf),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget draftCard(Json d) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
    decoration: BoxDecoration(
      color: sunshine,
      borderRadius: BorderRadius.circular(22),
    ),
    child: Row(
      children: [
        const Text('⏳', style: TextStyle(fontSize: 24)),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            d['rejected'] == 1
                ? 'This photo couldn’t be used'
                : 'Waiting to send when you’re online',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
        if (d['rejected'] == 1 || d['server_id'] == null)
          IconButton(
            tooltip: 'Discard',
            onPressed: () async {
              try {
                await farm.deleteDraft(d);
              } catch (_) {}
              reload();
            },
            icon: const Icon(Icons.close_rounded),
          ),
      ],
    ),
  );
}

// ── Take a photo ────────────────────────────────────────────────────────────

class PlayCheck extends StatefulWidget {
  const PlayCheck({super.key});
  @override
  State<PlayCheck> createState() => _PlayCheckState();
}

class _PlayCheckState extends State<PlayCheck> {
  String? draftId, photo;
  bool consent = true, busy = false;

  Future<void> pick(ImageSource source) async {
    try {
      await farm.cache('pending_capture', {'crop': 'unknown'});
      final file = await ImagePicker().pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1600,
        maxHeight: 1600,
      );
      if (file == null) return;
      // The AI identifies the plant, so the crop is left as "unknown".
      final key = await farm.capture(file.path, 'unknown', null);
      final rows = await farm.db.query(
        'drafts',
        where: 'id=?',
        whereArgs: [key],
      );
      setState(() {
        draftId = key;
        photo = rows.first['photo'] as String;
      });
    } catch (_) {
      say('Camera unavailable — try the gallery instead.');
    }
  }

  void say(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  Future<void> send() async {
    setState(() => busy = true);
    try {
      final row = (await farm.db.query(
        'drafts',
        where: 'id=?',
        whereArgs: [draftId],
      )).first;
      await farm.updateDraft(
        draftId!,
        jsonDecode(row['payload'] as String),
        ready: true,
      );
      if (farm.token == null) throw Exception('Please sign in first.');
      await farm.sync(force: true);
      final List uploaded = await farm.cached('cases');
      final match = uploaded.where((c) => c['client_submission_id'] == draftId);
      if (!mounted) return;
      if (match.isNotEmpty) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => PlayResult(id: match.first['id'])),
        );
      } else {
        say('Saved! It will be sent when you’re online 📶');
        Navigator.pop(context);
      }
    } catch (e) {
      say(
        'Saved on your phone. ${e.toString().replaceFirst('Exception: ', '')}',
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(22, 0, 22, 32),
      children: [
        Text(
          photo == null ? 'Snap your plant 📸' : 'Looking good! 👌',
          style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          photo == null
              ? 'Get close to the leaf that looks sick.'
              : 'Ready for the AI to take a look?',
          style: const TextStyle(fontSize: 17, color: Color(0xFF55605A)),
        ),
        const SizedBox(height: 22),
        ClipRRect(
          borderRadius: BorderRadius.circular(32),
          child: photo == null
              ? Container(
                  height: 280,
                  color: mint,
                  alignment: Alignment.center,
                  child: const Text('🍃', style: TextStyle(fontSize: 96)),
                )
              : Image.file(
                  File(photo!),
                  height: 360,
                  width: double.infinity,
                  fit: BoxFit.cover,
                ),
        ),
        const SizedBox(height: 24),
        if (photo == null) ...[
          FilledButton.icon(
            onPressed: () => pick(ImageSource.camera),
            icon: const Icon(Icons.photo_camera_rounded),
            label: const Text('Take photo'),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => pick(ImageSource.gallery),
            icon: const Icon(Icons.photo_library_rounded),
            label: const Text('Pick from gallery'),
          ),
        ] else ...[
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(22),
            ),
            child: SwitchListTile(
              value: consent,
              onChanged: (v) => setState(() => consent = v),
              activeThumbColor: leaf,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              title: const Text(
                'Send to AI for a check',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: const Text('Google Gemini or Anthropic Claude'),
            ),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: busy || !consent ? null : send,
            icon: busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: Colors.white,
                    ),
                  )
                : const Text('✨', style: TextStyle(fontSize: 20)),
            label: Text(busy ? 'Sending…' : 'Check my plant'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: busy
                ? null
                : () async {
                    final id = draftId;
                    setState(() => photo = draftId = null);
                    final rows = await farm.db.query(
                      'drafts',
                      where: 'id=?',
                      whereArgs: [id],
                    );
                    if (rows.isNotEmpty) await farm.deleteDraft(rows.first);
                  },
            child: const Text('Retake'),
          ),
        ],
      ],
    ),
  );
}

// ── Result ──────────────────────────────────────────────────────────────────

class PlayResult extends StatefulWidget {
  final String id;
  const PlayResult({super.key, required this.id});
  @override
  State<PlayResult> createState() => _PlayResultState();
}

class _PlayResultState extends State<PlayResult> {
  Json? data;
  Timer? poll;

  @override
  void initState() {
    super.initState();
    load();
    watch();
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  // Keep checking while the AI is still working on this photo.
  void watch() {
    poll?.cancel();
    poll = Timer.periodic(const Duration(seconds: 3), (_) {
      final state = data?['processing_state'];
      if (state == 'completed' || state == 'failed') {
        poll?.cancel();
      } else {
        load();
      }
    });
  }

  Future<void> load() async {
    final cached = await farm.cached('case:${widget.id}', <String, dynamic>{});
    if (mounted && data == null && cached.isNotEmpty) {
      setState(() => data = Map<String, dynamic>.from(cached));
    }
    try {
      final Json fresh = await farm.request('/cases/${widget.id}');
      await farm.cache('case:${widget.id}', fresh);
      if (mounted) setState(() => data = fresh);
    } catch (_) {}
  }

  Future<void> retry() async {
    try {
      await farm.request('/cases/${widget.id}/retry', method: 'POST', body: {});
      await load();
      watch();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final d = data;
    final a = d == null ? null : analysisOf(d);
    final look = lookFor(a, d?['processing_state']);
    final plant = a?['plant'] as String?;
    final condition =
        (a?['candidates'] as List?)?.firstOrNull?['condition'] as String?;
    final images = (d?['images'] as List?) ?? [];
    final steps = (a?['next_steps'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Your result',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: d == null
          ? const Center(child: CircularProgressIndicator(color: leaf))
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
              children: [
                if (images.isNotEmpty && farm.token != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(32),
                    child: Image.network(
                      '$apiBase/cases/${widget.id}/images/${images.first['id']}',
                      headers: {'Authorization': 'Bearer ${farm.token}'},
                      height: 260,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    ),
                  ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: look.color,
                    borderRadius: BorderRadius.circular(32),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            look.emoji,
                            style: const TextStyle(fontSize: 40),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              look.headline,
                              style: const TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (a == null && d['processing_state'] != 'failed') ...[
                        const SizedBox(height: 14),
                        const LinearProgressIndicator(
                          color: leaf,
                          backgroundColor: Colors.white,
                          borderRadius: BorderRadius.all(Radius.circular(9)),
                        ),
                      ],
                      if (plant != null || condition != null) ...[
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (plant != null)
                              pill('${plantEmoji(plant)} $plant', Colors.white),
                            if (a?['confidence'] != null)
                              pill(
                                '${'●' * {'low': 1, 'medium': 2, 'high': 3}[a!['confidence']]!}${'○' * (3 - {'low': 1, 'medium': 2, 'high': 3}[a['confidence']]!)}  ${a['confidence']} confidence',
                                Colors.white,
                              ),
                          ],
                        ),
                      ],
                      if (condition != null) ...[
                        const SizedBox(height: 14),
                        Text(
                          condition,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                      if (a != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          a['reason'],
                          style: const TextStyle(fontSize: 16, height: 1.45),
                        ),
                      ],
                    ],
                  ),
                ),
                if (steps.isNotEmpty) ...[
                  const SizedBox(height: 26),
                  const Text(
                    'How to fix it 💪',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  for (final (i, s) in steps.indexed)
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(22),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(
                              color: mint,
                              shape: BoxShape.circle,
                            ),
                            child: Text(
                              '${i + 1}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                color: leafDark,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              s,
                              style: const TextStyle(fontSize: 16, height: 1.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
                if (d['processing_state'] == 'failed') ...[
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: retry,
                    child: const Text('Try again'),
                  ),
                ],
                const SizedBox(height: 18),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(builder: (_) => const PlayCheck()),
                  ),
                  icon: const Text('📸', style: TextStyle(fontSize: 18)),
                  label: const Text('Check another plant'),
                ),
                if (a != null) ...[
                  const SizedBox(height: 18),
                  const Text(
                    'AI suggestion, not a final diagnosis. Ask an extension officer before using chemicals.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: Color(0xFF7A837A)),
                  ),
                ],
              ],
            ),
    );
  }
}

// ── Sign in / create account ────────────────────────────────────────────────

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool creating = false, busy = false, hidden = true;
  String? error;
  final name = TextEditingController();
  final phone = TextEditingController();
  final password = TextEditingController();
  final form = GlobalKey<FormState>();

  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (creating) {
        await farm.register(name.text.trim(), phone.text, password.text);
      } else {
        await farm.signIn(phone.text, password.text);
      }
    } on ApiException catch (e) {
      setState(() => error = e.message);
    } catch (_) {
      setState(
        () => error = 'Can’t reach AgroSense. Check your Wi-Fi and try again.',
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  InputDecoration field(String label, IconData icon, {String? hint}) =>
      InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon, color: leafDark),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide.none,
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Form(
        key: form,
        // A plain scroll view keeps every field built, so off-screen fields are
        // still validated (a lazy ListView would drop them).
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 36, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Image.asset('assets/logo.png', width: 104, height: 104),
              ),
              const SizedBox(height: 10),
              Text(
                creating ? 'Join AgroSense' : 'Welcome back!',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                creating
                    ? 'Create an account to check your plants.'
                    : 'Sign in to check your plants.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, color: Color(0xFF55605A)),
              ),
              const SizedBox(height: 26),
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Sign in')),
                  ButtonSegment(value: true, label: Text('Create account')),
                ],
                selected: {creating},
                showSelectedIcon: false,
                onSelectionChanged: (v) => setState(() {
                  creating = v.first;
                  error = null;
                }),
              ),
              const SizedBox(height: 20),
              if (creating) ...[
                TextFormField(
                  controller: name,
                  textCapitalization: TextCapitalization.words,
                  decoration: field('Your name', Icons.person_rounded),
                  validator: (v) =>
                      (v ?? '').trim().isEmpty ? 'Tell us your name' : null,
                ),
                const SizedBox(height: 12),
              ],
              TextFormField(
                controller: phone,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: field(
                  'Phone number',
                  Icons.phone_rounded,
                  hint: '081 234 5678',
                ),
                validator: (v) =>
                    (v ?? '').replaceAll(RegExp(r'\D'), '').length < 8
                    ? 'Enter your phone number'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: password,
                obscureText: hidden,
                autofillHints: [
                  creating ? AutofillHints.newPassword : AutofillHints.password,
                ],
                decoration: field('Password', Icons.lock_rounded).copyWith(
                  helperText: creating ? 'At least 8 characters' : null,
                  suffixIcon: IconButton(
                    tooltip: hidden ? 'Show password' : 'Hide password',
                    onPressed: () => setState(() => hidden = !hidden),
                    icon: Icon(
                      hidden
                          ? Icons.visibility_rounded
                          : Icons.visibility_off_rounded,
                    ),
                  ),
                ),
                validator: (v) => creating && (v ?? '').length < 8
                    ? 'Use at least 8 characters'
                    : (v ?? '').isEmpty
                    ? 'Enter your password'
                    : null,
                onFieldSubmitted: (_) => submit(),
              ),
              if (error != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: peach,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Text(
                    error!,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              const SizedBox(height: 22),
              FilledButton(
                onPressed: busy ? null : submit,
                child: busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : Text(creating ? 'Create account' : 'Sign in'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

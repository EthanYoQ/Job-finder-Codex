"""Private, synchronous admission inside the original installer owner.
No tool wrappers, process killing, asynchronous authority or public enable flag.
Accounting/config are fixed source bytes embedded by the source renderer.
"""
from pathlib import Path
import errno, json, os, shutil, stat, time, types
CHUNK = 64 * 1024
SCAN_INTERVAL = 5.0
SCAN_DEADLINE = 10.0
MAX_PENDING = 32 * 1024 * 1024
META = 64 * 1024

class Hold(RuntimeError): pass

def require(ok, reason):
    if not ok: raise Hold(reason)

def sticky(method):
    def wrapped(self, *args, **kwargs):
        require(not self.failed, 'BUDGET_FAILURE_LATCHED')
        try: return method(self, *args, **kwargs)
        except BaseException:
            self.failed = True
            raise
    return wrapped

class Guard:
    def __init__(self, accounting_source, config, pins, scope):
        require(scope == {'kind':'FIXED_PRODUCTION','parent':'/workspace/scratch/5e9614251709','target':'job-finder-fixed-live-controller-v1'}, 'BUDGET_FIXED_SCOPE')
        self.a = types.ModuleType('original_owned_budget_accounting')
        exec(compile(accounting_source, '<embedded-budget-accounting>', 'exec'), self.a.__dict__)
        self.config = self.a.validate_config(config)
        self.a.verify_provenance(config)
        self.a.check_fresh_absence(config)
        self.failed = False
        self.pending = 0
        self.last_full = 0
        # Old source paths are historical accounting provenance, not the new
        # candidate identity. New measured inputs are additional full charges.
        old_path = next(p for p in config['provenanceSha256'] if p.endswith('/INSTALL_MEASURED_PINS.json'))
        old = json.loads(Path(old_path).read_bytes())
        registered = [Path(p) for p in config['registeredRoots']] + [Path(config['ownRoot'])]
        candidates = [Path(pins[k]) for k in ('sourceRoot','builtRoot','evidenceRoot')]
        candidates += [Path(pins[k]).parent for k in ('sourceManifestPath','nodePath') if pins[k] != old[k]]
        candidates = sorted(set(candidates), key=lambda p: (len(p.parts), str(p)))
        self.extra = []
        for path in candidates:
            require(path.is_absolute() and path == path.resolve(strict=True), 'BUDGET_INPUT_ALIAS')
            if any(path.is_relative_to(root) for root in registered + self.extra): continue
            require(path.is_relative_to(Path(config['workspace'])) and
                    all(not root.is_relative_to(path) for root in registered) and
                    all(not path.is_relative_to(Path(root)) and not Path(root).is_relative_to(path)
                        for root in config['formalRoots'].values()), 'BUDGET_INPUT_SCOPE')
            self.extra.append(path)
        baseline = self.read_full()
        self.ledger = self.a.Ledger(baseline, self.a.load_state_parent_baselines(config))
        self.latest = self.ledger.register(baseline)
        self.extra_high = {str(p):baseline['registered'][str(p)] for p in self.extra}
        self.extra_phase = sum(self.extra_high.values())
        self.latest['phase'] += self.extra_phase
        self.a.check_limits(self.latest, startup=True)
        self.last_full = time.monotonic()

    def read_full(self):
        started = time.monotonic()
        self.a.SCAN_DEADLINE_AT = started + SCAN_DEADLINE
        value = self.a.read_full(self.config)
        for path in self.extra:
            value['registered'][str(path)] = self.a.allocated(path, required=True)
        require(time.monotonic() - started <= SCAN_DEADLINE, 'BUDGET_SCAN_DEADLINE')
        return value

    def before(self, growth=0, *, full=False):
        require(not self.failed, 'BUDGET_FAILURE_LATCHED')
        try:
            require(type(growth) is int and growth >= 0, 'BUDGET_RESERVATION')
            refreshed = False
            def refresh():
                nonlocal refreshed
                observed = self.read_full()
                self.latest = self.ledger.register(observed)
                for path in self.extra:
                    key = str(path)
                    self.extra_high[key] = max(self.extra_high[key], observed['registered'][key])
                self.extra_phase = sum(self.extra_high.values())
                self.pending = 0
                self.last_full = time.monotonic()
                refreshed = True
            def actual():
                sample = self.ledger.sample(self.a.free(self.a.WORKSPACE), self.a.free('/tmp'), time.monotonic())
                sample = dict(sample)
                sample['phase'] += self.extra_phase
                # An actual free/cap breach is terminal, never a reason to wait
                # for cleanup. Only unspent conservative reservations may be
                # reconciled, and only by a completed full registered scan.
                self.a.check_limits(sample)
                return sample
            def projected():
                sample = actual()
                reserve = self.pending + growth
                sample['charged'] += reserve
                sample['phase'] += reserve
                sample['workspaceFree'] -= reserve
                return sample
            actual()
            if full or time.monotonic() - self.last_full >= SCAN_INTERVAL or self.pending + growth >= MAX_PENDING:
                refresh()
            value = projected()
            try:
                self.a.check_limits(value)
            except self.a.Hold:
                if not self.pending or refreshed: raise
                refresh()
                self.a.check_limits(projected())
            self.pending += growth
        except BaseException:
            self.failed = True
            raise

    def after(self): self.before()

    @sticky
    def metadata(self, src=None):
        size = META
        if src is not None and hasattr(os, 'listxattr'):
            for name in os.listxattr(src, follow_symlinks=False):
                size += len(os.getxattr(src, name, follow_symlinks=False)) + META
        self.before(size)

    @sticky
    def write(self, fd, raw):
        offset = 0
        while offset < len(raw):
            block = raw[offset:offset + CHUNK]
            self.before(((len(block) + 4095) // 4096) * 4096 + 8192)
            count = os.write(fd, block)
            require(count > 0, 'BUDGET_SHORT_WRITE')
            offset += count
            self.after()

    @sticky
    def put(self, path, raw, mode=0o600):
        self.metadata()
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        try: self.write(fd, raw); os.fsync(fd)
        finally: os.close(fd)
        self.after()

    @sticky
    def copy2(self, src, dst):
        self.metadata()
        source = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
        dest = None
        try:
            before = os.fstat(source)
            require(stat.S_ISREG(before.st_mode), 'BUDGET_COPY_REGULAR_ONLY')
            dest = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, stat.S_IMODE(before.st_mode))
            while True:
                self.before()
                raw = os.read(source, CHUNK)
                if not raw: break
                self.write(dest, raw)
            after = os.fstat(source)
            sig = lambda s: (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            require(sig(before) == sig(after) == sig(os.lstat(src)), 'BUDGET_COPY_SOURCE_CHANGED')
        finally:
            if dest is not None: os.close(dest)
            os.close(source)
        self.metadata(src); shutil.copystat(src, dst); self.after()
        return str(dst)

    @sticky
    def copytree(self, src, dst):
        # copytree(symlinks=True) semantics on the validated source domains:
        # no dereferencing, no hardlinks, file+directory mode/time/xattrs kept.
        self.metadata(); os.mkdir(dst)
        with os.scandir(src) as stream:
            for entry in stream:
                source, target = Path(entry.path), Path(dst) / entry.name
                self.before()
                if entry.is_symlink():
                    self.metadata(source); os.symlink(os.readlink(source), target)
                    shutil.copystat(source, target, follow_symlinks=False); self.after()
                elif entry.is_dir(follow_symlinks=False): self.copytree(source, target)
                elif entry.is_file(follow_symlinks=False): self.copy2(source, target)
                else: raise Hold('BUDGET_COPY_SPECIAL_FILE')
        self.metadata(src); shutil.copystat(src, dst); self.after()
        return str(dst)

import importlib.util
import os

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_actor(rel_path, fn_name):
    spec = importlib.util.spec_from_file_location(
        fn_name, os.path.join(_BASE_DIR, rel_path)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, fn_name)


checkBureau = _load_actor("checkBureau/checkBureau.py", "checkBureau")

ACTOR_REGISTRATIONS = [
    {
        "parent_fsm_name": "creditCheck",
        "parent_fsm_version": "v01",
        "fsm_type": "promise",
        "fsm_name": "checkBureau",
        "fsm_version": "v01",
        "fsm_language": "python",
        "handler": checkBureau,
    },
]

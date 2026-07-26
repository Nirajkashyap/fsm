"""Discovers and verifies python promise-actor folders.

Python counterpart of
../typescript/validate-async-operation.ts's
validateAsyncOperationFromFoldersTypescript, walking
<folder_path>/<fsm_name>/<version>/python/actors/<actor_name>/<actor_name>.py
(this repo's real FSM actor convention — see
apps/fsm-core-example/fsm/creditCheck/v01/python/actors/checkBureau/checkBureau.py)
instead of the typescript file's .../typescript/actors/... path.

Verification inlines packages/fsm-compiler-ts/src/checkers/check_fn.py's own
check (ast.walk for a FunctionDef/AsyncFunctionDef matching the actor name)
directly in-process, the same way the typescript file inlines check_fn.ts's
check instead of shelling out to it — this file only ever checks python, in
a process that's already Python.
"""

from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass
from typing import List, Optional

LANG = "python"

_VERSION_FOLDER_RE = re.compile(r"^v\d{2}$")


def _is_version_folder_name(name: str) -> bool:
    # Mirrors @pgfsm/compiler's util.ts isVersionFolderName: /^v\d{2}$/.
    return bool(_VERSION_FOLDER_RE.match(name))


def _has_fn(source: str, fn_name: str) -> bool:
    for node in ast.walk(ast.parse(source)):
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == fn_name
        ):
            return True
    return False


@dataclass
class ActorPluginValidationResult:
    """Mirrors @pgfsm/compiler's ActorPluginValidationResult (util.ts)."""

    src: str
    method: str
    fsm_name: str
    fsm_type: str
    fsm_version: str
    fsm_language: str
    is_verified: bool
    fsm_module_path: str
    parent_fsm_name: str
    parent_fsm_version: str
    comment: str
    parent_fsm_path: str
    error_message: Optional[str]


def validate_async_operation_from_folders_python(
    folder_path: str,
    workflow_type: str,
    skip_dirs: Optional[List[str]] = None,
) -> List[ActorPluginValidationResult]:
    del workflow_type  # unused — kept for parity with validateAsyncOperationFromFolders
    skip_dirs = skip_dirs or []

    if folder_path.startswith("."):
        raise ValueError(
            f"Invalid folder path: {folder_path}. Folder paths cannot start with '.'"
        )
    if folder_path.endswith("/"):
        raise ValueError(
            f"Invalid folder path: {folder_path}. Folder paths cannot end with '/'"
        )

    abs_folder_path = (
        folder_path
        if folder_path.startswith("/")
        else os.path.join(os.getcwd(), folder_path)
    )

    results: List[ActorPluginValidationResult] = []

    if not os.path.isdir(abs_folder_path):
        print(f"Provided path is not a directory: {abs_folder_path}")
        return results

    for fsm_name in sorted(os.listdir(abs_folder_path)):
        if fsm_name in skip_dirs:
            continue
        fsm_dir_path = os.path.join(abs_folder_path, fsm_name)
        if not os.path.isdir(fsm_dir_path):
            continue

        for version in sorted(os.listdir(fsm_dir_path)):
            version_path = os.path.join(fsm_dir_path, version)
            if not os.path.isdir(version_path):
                continue
            if not _is_version_folder_name(version):
                continue

            lang_path = os.path.join(version_path, LANG)
            if not os.path.isdir(lang_path):
                continue

            actors_path = os.path.join(lang_path, "actors")
            if not os.path.isdir(actors_path):
                continue

            for actor_name in sorted(os.listdir(actors_path)):
                actor_dir = os.path.join(actors_path, actor_name)
                if not os.path.isdir(actor_dir):
                    continue

                module_path = os.path.join(actor_dir, f"{actor_name}.py")
                if not os.path.isfile(module_path):
                    continue

                is_verified = False
                error_message: Optional[str] = None
                try:
                    with open(module_path) as f:
                        source = f.read()
                    if _has_fn(source, actor_name):
                        is_verified = True
                    else:
                        error_message = (
                            f"Function '{actor_name}' not found in {module_path}"
                        )
                except (OSError, SyntaxError) as exc:
                    error_message = f"Failed to parse {module_path}: {exc}"

                results.append(
                    ActorPluginValidationResult(
                        src=actor_name,
                        method=actor_name,
                        fsm_name=actor_name,
                        fsm_type="promise",
                        fsm_version=version,
                        fsm_language=LANG,
                        is_verified=is_verified,
                        fsm_module_path=module_path,
                        parent_fsm_name=fsm_name,
                        parent_fsm_version=version,
                        comment="fsmVersion is parentFsmVersion for fsmType promise",
                        parent_fsm_path=fsm_dir_path,
                        error_message=error_message,
                    )
                )

    return results

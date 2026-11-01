"""Tests run fully offline against the bundled snapshot."""

import os

os.environ["GRIDBICK_DATA_SOURCE"] = "snapshot"

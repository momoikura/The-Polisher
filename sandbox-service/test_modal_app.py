"""Tests for the sandbox's pure helpers. Run: py -m pytest sandbox-service -q"""

from modal_app import classify_base_failures


def junit(*cases: str) -> str:
    return f'<testsuites><testsuite name="pytest">{"".join(cases)}</testsuite></testsuites>'


ASSERTION = """<testcase classname="tests.test_replace_empty" name="test_no_match">
<failure message="AssertionError: assert [None] == []">def test_no_match():
&gt;       assert list(replace([], pred, [9], window_size=2)) == []
E       AssertionError: assert [None] == []
E         Left contains one more item: None

tests/test_replace_empty.py:12: AssertionError</failure></testcase>"""

MISSING = """<testcase classname="tests.test_new" name="test_helper">
<error message="collection failure">tests/test_new.py:1: in &lt;module&gt;
E   ImportError: cannot import name 'new_helper' from 'pkg'</error></testcase>"""

PASSING = '<testcase classname="tests.test_ok" name="test_ok"/>'


def test_a_reproducing_failure_gives_its_assertion_as_the_example():
    result = classify_base_failures(junit(ASSERTION, PASSING))

    assert result["reproduced"] == 1
    assert result["missingCode"] == 0
    assert result["example"] == "AssertionError: assert [None] == []\nLeft contains one more item: None"


def test_pytest_hints_are_left_out_of_the_example():
    case = ASSERTION.replace("Left contains one more item: None", "Left contains one more item: None\nE         Use -v to get more diff")

    assert classify_base_failures(junit(case))["example"] == "AssertionError: assert [None] == []\nLeft contains one more item: None"


def test_a_reproducing_failure_is_preferred_over_missing_code():
    result = classify_base_failures(junit(MISSING, ASSERTION))

    assert (result["reproduced"], result["missingCode"]) == (1, 1)
    assert result["example"].startswith("AssertionError: assert [None] == []")


def test_only_missing_code_names_what_is_missing():
    result = classify_base_failures(junit(MISSING))

    assert (result["reproduced"], result["missingCode"]) == (0, 1)
    assert result["example"] == "ImportError: cannot import name 'new_helper' from 'pkg'"


def test_without_E_lines_the_failure_message_is_used():
    case = '<testcase classname="t" name="x"><failure message="Failed: DID NOT RAISE ValueError">trace</failure></testcase>'

    assert classify_base_failures(junit(case))["example"] == "Failed: DID NOT RAISE ValueError"

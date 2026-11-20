import re
import sys

def main():
    path = 'src/pages/StudentProfile.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add activeTab state
    content = content.replace(
        "const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);",
        "const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);\n  const [activeTab, setActiveTab] = useState<'profile' | 'telemetry'>('profile');"
    )

    # 2. Add Tabs UI right before <div className="bento-grid">
    tabs_ui = """
      {/* Tabs */}
      <div className="flex gap-4 mb-6" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        <button 
          onClick={() => setActiveTab('profile')} 
          style={{ 
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'profile' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'profile' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          Profile & History
        </button>
        <button 
          onClick={() => setActiveTab('telemetry')} 
          style={{ 
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'telemetry' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'telemetry' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          <Sparkles size={16} style={{ display: 'inline', marginRight: '0.5rem', marginBottom: '2px' }} />
          Telemetry Analytics
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'profile' && (
          <motion.div key="profile" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bento-grid">
"""
    content = content.replace('<div className="bento-grid">', tabs_ui, 1)

    # 3. Personal Details: Change col-span-4 to col-span-12
    # Find the Personal Details card
    content = content.replace(
        '{/* Personal Details */}\n        <motion.div variants={item} className="bento-card col-span-4">',
        '{/* Personal Details */}\n        <motion.div variants={item} className="bento-card col-span-12 lg:col-span-12">'
    )

    # Now we need to extract Clinical Telemetry Profile block and Counseling History block.
    # The file structure is:
    # {tabs_ui}
    # {/* Personal Details */}
    # ...
    # </motion.div>
    # 
    # {/* ── Clinical Telemetry & Radar Cockpit Card ── */}
    # ...
    # </motion.div>
    #
    # {/* History Timeline */}
    # ...
    # </motion.div>
    # 
    # {activeAssessmentId && (

    # We will split the content using these markers.
    marker1 = "{/* ── Clinical Telemetry & Radar Cockpit Card ── */}"
    marker2 = "{/* History Timeline */}"
    marker3 = "{activeAssessmentId && ("

    part_before_telemetry, rest1 = content.split(marker1, 1)
    telemetry_block, rest2 = rest1.split(marker2, 1)
    history_block, part_after_history = rest2.split(marker3, 1)

    # We need to change telemetry block:
    # 1. change col-span-8 to col-span-12
    telemetry_block = telemetry_block.replace('className="bento-card col-span-8"', 'className="bento-card col-span-12"')
    
    # 2. Extract tension alerts.
    tension_start = "{/* Tension Alerts */}"
    tension_end = "})()}\n            </div>\n          )}\n        </motion.div>\n"
    
    if tension_start in telemetry_block:
        t_before, t_rest = telemetry_block.split(tension_start, 1)
        t_tensions, t_after = t_rest.split(tension_end, 1)
        
        # Rewrite tensions to be a full-width bento card BELOW the radar chart card
        # Remember, t_before ends with </RadarChart> ... </div>
        
        tensions_card = f"""
        </motion.div>

        {'{/* Cross-Domain Tension Warnings */}'}
        <motion.div variants={{item}} className="bento-card col-span-12">
          <h3 className="text-h3 mb-4 flex items-center gap-2" style={{ color: '#f59e0b' }}>
            <AlertTriangle size={{18}} /> Tension Warnings
          </h3>
          {tension_start}{t_tensions}}})()}}
        </motion.div>
"""
        new_telemetry_block = t_before + "            </div>\n          )}\n" + tensions_card + "\n" + t_after
    else:
        new_telemetry_block = telemetry_block

    # Combine back in the requested order:
    # ... Personal Details ...
    # history_block
    # </motion.div> (end of profile grid)
    # {activeTab === 'telemetry' && (
    #   <motion.div key="telemetry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bento-grid">
    #     marker1 + new_telemetry_block
    #   </motion.div>
    # )}
    # marker3 + part_after_history

    final_content = (
        part_before_telemetry +
        marker2 + history_block +
        "          </motion.div>\n        )}\n\n" +
        "        {activeTab === 'telemetry' && (\n" +
        "          <motion.div key=\"telemetry\" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className=\"bento-grid\">\n" +
        "            " + marker1 + new_telemetry_block +
        "          </motion.div>\n        )}\n" +
        "      </AnimatePresence>\n\n      " + marker3 + part_after_history
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(final_content)
    
    print("Successfully refactored StudentProfile.tsx")

if __name__ == "__main__":
    main()
